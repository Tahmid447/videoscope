"""Bounded HTTP reads, pinned DNS, per-analysis cookies, no browser bypass."""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from collections.abc import Callable
import logging

import aiohttp

from .security import MediaError, PublicResolver, public_url

log = logging.getLogger("videoscope.media")
CHUNK = 64 * 1024


def signature(data: bytes) -> str | None:
    if len(data) > 12 and data[4:8] == b"ftyp":
        return "mp4"
    if data.startswith(b"\x1aE\xdf\xa3"):
        return "webm"
    if data.startswith(b"OggS"):
        return "ogg"
    return None


class SafeHTTP:
    def __init__(self, hosts: tuple[str, ...] = (), resolver=None):
        self.hosts = hosts
        self.resolver = resolver or PublicResolver()
        self.session: aiohttp.ClientSession | None = None

    async def start(self):
        self.session = aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(resolver=self.resolver, use_dns_cache=False, force_close=True, limit=8),
            timeout=aiohttp.ClientTimeout(total=None, connect=10, sock_read=30),
            headers={"User-Agent": "VideoScope/4.0 media-client", "Accept-Encoding": "identity"},
            trust_env=False, auto_decompress=False, cookie_jar=aiohttp.CookieJar(),
        )
        return self

    async def close(self):
        if self.session:
            await self.session.close()

    @asynccontextmanager
    async def open(self, url: str, *, referer: str | None = None, byte_range: tuple[int, int] | None = None):
        if not self.session:
            await self.start()
        target = public_url(url, self.hosts)
        headers = {"Accept": "*/*"}
        if referer:
            headers["Referer"] = public_url(referer, self.hosts)
        if byte_range:
            headers["Range"] = f"bytes={byte_range[0]}-{byte_range[1]}"
        response = None
        try:
            for _ in range(6):
                assert self.session is not None
                selected = {**getattr(self, "headers_by_host", {}).get(urlsplit(target).hostname, {}), **headers}
                response = await self.session.get(target, headers=selected, allow_redirects=False)
                if response.status in (301, 302, 303, 307, 308):
                    location = response.headers.get("Location")
                    response.close()
                    if not location:
                        raise MediaError("bad_redirect", "The source returned an empty redirect.")
                    target = public_url(urljoin(target, location), self.hosts)
                    continue
                if response.status not in (200, 206):
                    status = response.status
                    log.info("upstream_response host=%s status=%s", urlsplit(target).hostname, status)
                    response.close()
                    raise MediaError("upstream_http", f"The source server returned HTTP {status}.", 502, status)
                if response.headers.get("Content-Encoding", "identity").lower() not in ("", "identity"):
                    raise MediaError("unsupported_encoding", "The source returned an unsupported compressed response.", 502)
                yield response, target
                return
            raise MediaError("redirect_limit", "The source redirected too many times.")
        except (aiohttp.ClientError, TimeoutError) as e:
            log.info("upstream_failure host=%s error=%s", urlsplit(target).hostname, type(e).__name__)
            raise MediaError("source_unreachable", "The source connection failed or timed out.", 502) from None
        finally:
            if response:
                response.close()

    async def read(self, url: str, *, limit: int = 2_000_000, referer: str | None = None) -> tuple[bytes, str, dict]:
        async with self.open(url, referer=referer) as (r, final):
            chunks, size = [], 0
            async for chunk in r.content.iter_chunked(CHUNK):
                size += len(chunk)
                if size > limit:
                    raise MediaError("metadata_limit", "The source metadata exceeded the configured limit.")
                chunks.append(chunk)
            return b"".join(chunks), final, dict(r.headers)

    async def inspect(self, url: str, referer: str | None = None) -> tuple[bytes, str, dict]:
        async with self.open(url, referer=referer, byte_range=(0, CHUNK - 1)) as (r, final):
            prefix = await r.content.read(CHUNK)
            while len(prefix) < 512:
                more = await r.content.read(512 - len(prefix))
                if not more:
                    break
                prefix += more
            headers = dict(r.headers)
            headers["X-Inspected-Status"] = str(r.status)
            return prefix, final, headers

    async def save(self, url: str, dest: Path, *, limit: int, progress: Callable[[int, int | None], None], referer: str | None = None, byte_range: tuple[int, int] | None = None) -> tuple[int, bytes]:
        async with self.open(url, referer=referer, byte_range=byte_range) as (r, _):
            if byte_range and (r.status != 206 or not r.headers.get("Content-Range", "").startswith(f"bytes {byte_range[0]}-")):
                raise MediaError("range_unsupported", "The source did not honor the requested segment byte range.", 502)
            if not byte_range and r.status == 206:
                raise MediaError("incomplete_source", "The source unexpectedly returned only a partial file.", 502)
            content_type = r.headers.get("Content-Type", "").lower()
            if "text/html" in content_type or "application/json" in content_type:
                raise MediaError("not_media", "The source returned a web page instead of a media file.", 502)
            total = r.content_length
            if total is not None and total > limit:
                raise MediaError("size_limit", "The requested video is larger than the configured limit.", 413)
            prefix, count = bytearray(), 0
            try:
                with dest.open("wb") as output:
                    async for chunk in r.content.iter_chunked(CHUNK):
                        count += len(chunk)
                        if count > limit:
                            raise MediaError("size_limit", "The requested video is larger than the configured limit.", 413)
                        if len(prefix) < 512:
                            prefix.extend(chunk[:512 - len(prefix)])
                        if bytes(prefix).lstrip().lower().startswith((b"<!doctype html", b"<html", b"{\"error")):
                            raise MediaError("not_media", "The source returned an error page instead of video.", 502)
                        output.write(chunk)
                        progress(count, total)
                if not count or (total is not None and count != total):
                    raise MediaError("interrupted", "The source download was interrupted.", 502)
                if byte_range and count != byte_range[1] - byte_range[0] + 1:
                    raise MediaError("bad_range", "The source returned an incomplete media segment.", 502)
                return count, bytes(prefix)
            except BaseException:
                dest.unlink(missing_ok=True)
                raise
