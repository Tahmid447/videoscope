"""Provider registry adapter; extracted remote URLs never become browser downloads."""
from http.cookies import SimpleCookie
from urllib.parse import urlsplit
from yarl import URL
from ..extraction import extract
from ..models import Analysis, Format, format_id
from ..security import MediaError, public_url


def provider_name(url):
    from yt_dlp.extractor import gen_extractor_classes
    return next((c.IE_NAME for c in gen_extractor_classes() if c.IE_NAME != 'generic' and c.suitable(url)), None)


def supported_format(f):
    return bool(f.get('url') and not f.get('has_drm') and f.get('protocol') in ('http', 'https', 'm3u8', 'm3u8_native'))


def track(f):
    return {'url': public_url(f['url']), 'kind': 'hls' if 'm3u8' in f.get('protocol', '') else 'direct'}


async def analyze_provider(http, url, owner, ident, settings):
    data, warnings = await extract(url)
    if data.get('is_live') or data.get('live_status') in ('is_live', 'is_upcoming'):
        raise MediaError('live_stream', 'Choose a completed video rather than a live or upcoming broadcast.')
    fs = [f for f in data.get('formats', []) if supported_format(f)]
    audio = sorted([f for f in fs if f.get('vcodec') == 'none' and f.get('acodec') not in (None, 'none')], key=lambda f: f.get('tbr') or 0, reverse=True)
    videos = sorted([f for f in fs if f.get('vcodec') != 'none'], key=lambda f: (f.get('height') or 0, f.get('tbr') or 0), reverse=True)
    http.headers_by_host = {}
    for f in fs:
        headers = {k: str(v) for k, v in {**data.get('http_headers', {}), **(f.get('http_headers') or {})}.items()
                   if k.lower() in ('user-agent', 'referer', 'origin') and '\r' not in str(v) and '\n' not in str(v)}
        http.headers_by_host[urlsplit(f['url']).hostname] = headers
    for cookie in data.get('cookies', []):
        try:
            domain = cookie['domain'].lstrip('.')
            origin = public_url('https://'+domain+'/')
            jar = SimpleCookie()
            jar[cookie['name']] = cookie['value']
            jar[cookie['name']]['domain'] = cookie['domain']
            jar[cookie['name']]['path'] = cookie.get('path') or '/'
            jar[cookie['name']]['secure'] = cookie.get('secure', False)
            http.session.cookie_jar.update_cookies(jar, response_url=URL(origin))
        except (ValueError, KeyError, MediaError):
            continue
    formats, seen = [], set()
    for v in videos:
        a = None
        ext = v.get('ext') if v.get('ext') in ('mp4', 'webm', 'mkv', 'mov') else 'mp4'
        if v.get('acodec') == 'none':
            compatible = [f for f in audio if f.get('ext') in (('m4a', 'mp4') if ext == 'mp4' else ('webm',))]
            a = next(iter(compatible or audio), None)
            if not a:
                continue
            if not compatible:
                ext = 'mkv'
        key = (v.get('height'), ext, v.get('vcodec'))
        if key in seen:
            continue
        seen.add(key)
        records = [track(v)] + ([track(a)] if a else [])
        sizes = [f.get('filesize') for f in [v]+([a] if a else [])]
        size = sum(sizes) if all(isinstance(n, (int, float)) for n in sizes) else None
        ident_format = format_id('provider', str(v.get('format_id'))+'+'+str(a.get('format_id') if a else ''))
        label = (str(v['height'])+'p' if v.get('height') else 'Original')+' '+ext.upper()
        formats.append(Format(ident_format, ext, 'extracted', {'tracks': records, 'referer': data.get('webpage_url') or url},
            label=label, width=v.get('width'), height=v.get('height'), filesize=size,
            bitrate=int((v.get('tbr') or 0)*1000), video_codec=v.get('vcodec'), audio_codec=a.get('acodec') if a else v.get('acodec')))
    if not formats:
        raise MediaError('no_stream', 'This provider did not return a supported, retrievable video format. '+(' '.join(warnings[-1:]) if warnings else ''), 422)
    return Analysis(ident, owner, url, str(data.get('title') or 'Video')[:600], formats[:32], http,
        thumbnail=data.get('thumbnail'), duration=data.get('duration'), uploader=data.get('uploader') or data.get('channel'),
        upload_date=data.get('upload_date'), views=data.get('view_count'), provider=data.get('extractor_key') or 'yt-dlp', warnings=warnings)
