"""URL, DNS, token, filename, and request-budget boundaries."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import ipaddress
import json
import re
import secrets
import socket
import time
import unicodedata
from collections import defaultdict, deque
from urllib.parse import urlsplit, urlunsplit, quote

import aiohttp


class MediaError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, upstream_status: int | None = None):
        super().__init__(message)
        self.code, self.message, self.status, self.upstream_status = code, message, status, upstream_status


def public_ip(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
            address = address.ipv4_mapped
        return address.is_global and not (address.is_multicast or address.is_reserved or address.is_unspecified)
    except ValueError:
        return False


def public_url(raw: str, hosts: tuple[str, ...] = ()) -> str:
    if len(raw) > 4096 or any(ord(c) < 33 for c in raw) or "\\" in raw:
        raise MediaError("invalid_url", "Enter a complete HTTP or HTTPS video address.")
    try:
        u = urlsplit(raw)
        host, port = (u.hostname or "").lower().rstrip("."), u.port
        if u.scheme not in ("http", "https") or not host or u.username is not None or u.password is not None:
            raise ValueError()
        if port is not None and port not in (80, 443):
            raise ValueError()
        if host in ("localhost", "metadata.google.internal") or host.endswith((".localhost", ".local", ".internal")):
            raise ValueError()
        try:
            ipaddress.ip_address(host)
        except ValueError:
            host.encode("idna")
        else:
            if not public_ip(host):
                raise ValueError()
        if hosts and not any(host == h or (h.startswith("*.") and host.endswith(h[1:]) and host != h[2:]) for h in hosts):
            raise MediaError("host_not_enabled", "This source host is not enabled on this media server.")
        return urlunsplit((u.scheme, u.netloc, u.path or "/", u.query, ""))
    except (ValueError, UnicodeError):
        raise MediaError("unsafe_url", "Only public HTTP/HTTPS addresses on standard web ports are accepted.") from None


class PublicResolver(aiohttp.abc.AbstractResolver):
    """Resolve and vet the actual addresses passed to the HTTP connector.

    No validation/fetch DNS race: aiohttp connects to the vetted IPs directly,
    while preserving Host and TLS hostname verification. Disable DNS caching.
    """
    async def resolve(self, host: str, port: int = 0, family: int = socket.AF_UNSPEC):
        results = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(host, port, family=family, type=socket.SOCK_STREAM), 5)
        if not results or any(not public_ip(x[4][0]) for x in results):
            raise MediaError("unsafe_address", "The source resolved to a non-public network address.")
        return [{"hostname": host, "host": x[4][0], "port": port, "family": x[0], "proto": x[2], "flags": socket.AI_NUMERICHOST} for x in results]

    async def close(self):
        pass


def filename(value: str, extension: str) -> str:
    extension = extension.lower().lstrip(".")
    if extension not in {"mp4", "webm", "mkv", "mov", "ogg", "ogv", "m4v"}:
        raise MediaError("invalid_format", "Unsupported output file extension.")
    value = unicodedata.normalize("NFC", value)
    value = "".join(" " if unicodedata.category(c).startswith("C") else c for c in value)
    value = re.sub(r'[\\/:*?"<>|]', " ", value).strip(" .")
    value = re.sub(r"\s+", " ", value)
    while re.search(r"\.(mp4|webm|mkv|mov|ogg|ogv|m4v)$", value, re.I):
        value = value.rsplit(".", 1)[0].rstrip(" .")
    if re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])", value):
        value = "video-" + value
    value = value.encode("utf-8")[:170].decode("utf-8", "ignore").rstrip(" .") or "video"
    return value + "." + extension


def disposition(name: str) -> str:
    fallback = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    fallback = re.sub(r'[^a-zA-Z0-9 ._()-]', "_", fallback).strip(" .") or "video.mp4"
    return f'attachment; filename="{fallback}"; filename*=UTF-8\'\'{quote(name, safe="")}'


class Tokens:
    def __init__(self, secret: str):
        self.secret = secret.encode()

    def issue(self, kind: str, owner: str, seconds: int, **extra) -> str:
        data = {"kind": kind, "owner": owner, "exp": int(time.time()) + seconds, "nonce": secrets.token_hex(8), **extra}
        encoded = base64.urlsafe_b64encode(json.dumps(data, separators=(",", ":")).encode()).decode().rstrip("=")
        sig = hmac.new(self.secret, encoded.encode(), hashlib.sha256).hexdigest()
        return encoded + "." + sig

    def verify(self, token: str, kind: str) -> dict:
        try:
            if len(token) > 4096:
                raise ValueError()
            encoded, sig = token.rsplit(".", 1)
            expected = hmac.new(self.secret, encoded.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(sig, expected):
                raise ValueError()
            data = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
            if data["kind"] != kind or data["exp"] <= time.time():
                raise ValueError()
            return data
        except (ValueError, KeyError, TypeError):
            raise MediaError("expired_session", "This session or download link has expired. Sign in or request a new download link.", 401) from None


class RateLimit:
    def __init__(self):
        self.entries: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, maximum: int, period: int = 60):
        now = time.monotonic()
        q = self.entries[key]
        while q and q[0] <= now - period:
            q.popleft()
        if len(q) >= maximum:
            raise MediaError("rate_limit", "Too many requests. Please wait a minute and try again.", 429)
        q.append(now)
        if len(self.entries) > 10000:
            self.entries = defaultdict(deque, {k: v for k, v in self.entries.items() if v and v[-1] > now - 3600})
