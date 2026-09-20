"""Extraction-only HTTP proxy. Resolve once, reject private addresses, pin the socket.

Media transfers use SafeHTTP, not this proxy. The proxy is ephemeral and binds
only to loopback; its credential is passed to the extractor over stdin.
"""
import asyncio
import base64
import hmac
import secrets
from urllib.parse import urlsplit
from .security import PublicResolver, public_url


class EgressProxy:
    def __init__(self):
        self.secret = secrets.token_hex(24)
        self.server = None
        self.tasks = set()
        self.resolver = PublicResolver()

    async def __aenter__(self):
        self.server = await asyncio.start_server(self.handle, '127.0.0.1', 0, limit=32768)
        self.url = f'http://{self.secret}:x@127.0.0.1:{self.server.sockets[0].getsockname()[1]}'
        return self

    async def __aexit__(self, *args):
        self.server.close()
        await self.server.wait_closed()
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def handle(self, reader, writer):
        task = asyncio.current_task()
        self.tasks.add(task)
        upstream = None
        try:
            async with asyncio.timeout(90):
                raw = await reader.readuntil(b'\r\n\r\n')
                lines = raw.decode('iso-8859-1').split('\r\n')
                method, target, version = lines[0].split(' ', 2)
                headers = {}
                for line in lines[1:]:
                    if ':' in line:
                        k, v = line.split(':', 1)
                        headers[k.lower()] = v.strip()
                auth = 'Basic ' + base64.b64encode((self.secret+':x').encode()).decode()
                if not hmac.compare_digest(headers.get('proxy-authorization', ''), auth):
                    raise ValueError('Proxy authorization required')
                if method == 'CONNECT':
                    parsed = urlsplit(public_url('https://'+target))
                elif method in ('GET', 'POST', 'HEAD'):
                    parsed = urlsplit(public_url(target))
                    if parsed.scheme != 'http':
                        raise ValueError('HTTPS requires CONNECT')
                else:
                    raise ValueError('Unsupported method')
                port = parsed.port or (443 if method == 'CONNECT' else 80)
                choices = await self.resolver.resolve(parsed.hostname, port)
                error = None
                for address in choices:
                    try:
                        remote, upstream = await asyncio.wait_for(asyncio.open_connection(address['host'], port, family=address['family']), 10)
                        break
                    except (OSError, TimeoutError) as exc:
                        error = exc
                if upstream is None:
                    raise error or OSError('No route')
                if method == 'CONNECT':
                    writer.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
                    await writer.drain()
                else:
                    path = parsed.path or '/'
                    if parsed.query:
                        path += '?'+parsed.query
                    forwarded = [f'{method} {path} HTTP/1.1', 'Host: '+parsed.netloc, 'Connection: close']
                    for key, value in headers.items():
                        if key not in ('host', 'connection', 'proxy-connection', 'proxy-authorization'):
                            forwarded.append(key+': '+value)
                    upstream.write(('\r\n'.join(forwarded)+'\r\n\r\n').encode('iso-8859-1'))
                    await upstream.drain()
                async def relay(src, dst):
                    while chunk := await src.read(65536):
                        dst.write(chunk)
                        await dst.drain()
                peers = [asyncio.create_task(relay(reader, upstream)), asyncio.create_task(relay(remote, writer))]
                try:
                    _, pending = await asyncio.wait(peers, return_when=asyncio.FIRST_COMPLETED)
                finally:
                    for peer in peers:
                        peer.cancel()
                    await asyncio.gather(*peers, return_exceptions=True)
        except Exception:
            try:
                writer.write(b'HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
                await writer.drain()
            except Exception:
                pass
        finally:
            if upstream:
                upstream.close()
            writer.close()
            self.tasks.discard(task)
