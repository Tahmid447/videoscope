"""Isolated yt-dlp extraction; no downloading, shell execution, or raw URL logs."""
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from urllib.parse import urlsplit


def clean_error(value):
    value = re.sub(r'https?://\S+', '[source address]', str(value))
    return re.sub(r'\x1b\[[0-9;]*m', '', value)[-700:]


def emit(event):
    print(json.dumps(event, ensure_ascii=True, separators=(',', ':')), flush=True)


def number(value):
    return value if isinstance(value, (float, int)) and not isinstance(value, bool) and value >= 0 else None


def item(info, flat=False):
    url = info.get('webpage_url') or info.get('url') or ''
    if not isinstance(url, str) or not url.startswith(('https://', 'http://')):
        return None
    title = str(info.get('title') or '').strip()
    if not title or title in ('[Private video]', '[Deleted video]'):
        return None
    thumbs = info.get('thumbnails') or []
    thumbnail = info.get('thumbnail') or next((t.get('url') for t in reversed(thumbs) if t.get('url')), None)
    stamp = number(info.get('timestamp'))
    date = info.get('upload_date')
    published, precision = None, 'unavailable'
    try:
        if stamp is not None:
            published = datetime.fromtimestamp(stamp, timezone.utc).isoformat()
            precision = 'approximate' if flat else 'timestamp'
        elif date and re.fullmatch(r'\d{8}', str(date)):
            published = datetime.strptime(date, '%Y%m%d').replace(tzinfo=timezone.utc).isoformat()
            precision = 'approximate' if flat else 'day'
    except (ValueError, OverflowError, OSError):
        pass
    return {'id': hashlib.sha256(url.encode()).hexdigest()[:24], 'url': url, 'title': title[:600],
            'source': urlsplit(url).hostname, 'creator': info.get('uploader') or info.get('channel'),
            'thumbnail_url': thumbnail, 'duration_seconds': number(info.get('duration')),
            'views': number(info.get('view_count')), 'likes': number(info.get('like_count')),
            'rating': None, 'rating_best': None, 'rating_count': None, 'comments_count': number(info.get('comment_count')),
            'published_at': published, 'date_precision': precision, 'date_raw': 'Approximate source upload date' if flat and published else date,
            'is_hd': info.get('height', 0) >= 720 if isinstance(info.get('height'), (int, float)) else None,
            'tags': [str(t)[:120] for t in (info.get('tags') or [])[:40]], 'comments': [],
            'download_links': [], 'source_files': [], 'availability': info.get('availability') or 'listed',
            'extracted_by': info.get('extractor_key') or 'yt-dlp', 'fetched_at': datetime.now(timezone.utc).isoformat()}


def main():
    import yt_dlp
    from yt_dlp.extractor import gen_extractor_classes
    request = json.loads(sys.stdin.read(16384))
    mode, url = request['mode'], request['url']
    if mode == 'route':
        match = next((c.IE_NAME for c in gen_extractor_classes() if c.IE_NAME != 'generic' and c.suitable(url)), None)
        emit({'provider': match, 'supported': bool(match)})
        return

    class Logger:
        def debug(self, message):
            pass
        def warning(self, message):
            emit({'event': 'warning', 'message': clean_error(message)})
        def error(self, message):
            pass

    flat = mode == 'collection'
    opts = {'quiet': True, 'no_warnings': False, 'logger': Logger(), 'skip_download': True,
            'proxy': request['proxy'], 'socket_timeout': 12, 'retries': 1, 'extractor_retries': 1,
            'cachedir': False, 'noplaylist': not flat, 'ignoreerrors': False,
            'extract_flat': 'in_playlist' if flat else False, 'lazy_playlist': flat,
            'playlistend': request.get('limit', 10001) if flat else 1,
            'extractor_args': {'youtubetab': {'approximate_date': ['true']}},
            'js_runtimes': {'deno': {}}, 'remote_components': set()}
    with yt_dlp.YoutubeDL(opts) as ydl:
        data = ydl.extract_info(url, download=False)
        if not data:
            raise ValueError('The provider returned no metadata.')
        if flat:
            emit({'event': 'header', 'title': data.get('title') or data.get('channel') or 'Video collection',
                  'expected': number(data.get('playlist_count')), 'provider': data.get('extractor_key')})
            entries = data.get('entries') if data.get('_type') in ('playlist', 'multi_video') else [data]
            count = 0
            for entry in entries or []:
                if not entry:
                    continue
                # Nested channel tabs must be selected explicitly, never counted as videos.
                if entry.get('_type') in ('playlist', 'multi_video'):
                    emit({'event': 'warning', 'message': 'Choose a specific channel Videos, Shorts, or Streams tab to scan its videos.'})
                    continue
                if not entry.get('channel'):
                    entry['channel'] = data.get('channel') or data.get('uploader')
                value = item(entry, flat=True)
                if value:
                    emit({'event': 'item', 'item': value})
                    count += 1
            emit({'event': 'done', 'count': count})
        else:
            keys = ('id', 'url', 'title', 'thumbnail', 'thumbnails', 'duration', 'view_count', 'upload_date', 'timestamp',
                    'uploader', 'channel', 'extractor_key', 'is_live', 'live_status')
            safe = {k: data.get(k) for k in keys}
            safe['webpage_url'] = data.get('webpage_url') or url
            fields = ('format_id', 'url', 'ext', 'protocol', 'height', 'width', 'filesize', 'filesize_approx',
                      'tbr', 'vcodec', 'acodec', 'has_drm', 'manifest_url', 'http_headers')
            safe['formats'] = [{k: f.get(k) for k in fields} for f in data.get('formats', [data]) if f.get('url')][:200]
            safe['http_headers'] = data.get('http_headers') or {}
            safe['cookies'] = [{'name': c.name, 'value': c.value, 'domain': c.domain, 'path': c.path, 'secure': c.secure}
                               for c in ydl.cookiejar if c.domain][:100]
            emit({'event': 'analysis', 'info': safe})


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        emit({'event': 'error', 'message': clean_error(exc)})
        sys.exit(1)
