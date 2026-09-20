"""Cancelable bounded subprocess protocol shared by collection and video providers."""
import asyncio
import json
import os
import sys
from .egress import EgressProxy
from .security import MediaError, public_url


async def events(url, mode='video', limit=10001, timeout=45):
    url = public_url(url)
    async with EgressProxy() as proxy:
        process = await asyncio.create_subprocess_exec(sys.executable, '-m', 'media_api.worker',
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            limit=4_000_000, env={**os.environ, 'PYTHONUNBUFFERED': '1'})
        try:
            process.stdin.write(json.dumps({'url': url, 'mode': mode, 'proxy': proxy.url, 'limit': limit}).encode())
            await process.stdin.drain()
            process.stdin.close()
            total = 0
            async with asyncio.timeout(timeout):
                while line := await process.stdout.readline():
                    total += len(line)
                    if len(line) > 3_000_000 or total > 25_000_000:
                        raise MediaError('metadata_limit', 'The source metadata exceeded the extraction limit.', 413)
                    value = json.loads(line)
                    if value.get('event') == 'error':
                        raise MediaError('provider_failed', value['message'], 502)
                    yield value
                await process.wait()
            if process.returncode:
                raise MediaError('provider_failed', 'The source extractor did not finish successfully.', 502)
        except TimeoutError:
            raise MediaError('extraction_timeout', 'The source took too long to respond. Saved collection records have been preserved.', 504) from None
        finally:
            if process.returncode is None:
                process.kill()
            await process.wait()


async def extract(url):
    result = None
    warnings = []
    async for event in events(url):
        if event.get('event') == 'analysis':
            result = event['info']
        elif event.get('event') == 'warning':
            warnings.append(event['message'])
    if not result:
        raise MediaError('no_stream', 'No supported media representation was returned by this provider.')
    return result, warnings[-5:]
