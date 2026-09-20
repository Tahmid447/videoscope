"""Static, unencrypted HLS. Remote URLs are fetched by SafeHTTP, never FFmpeg."""
import re
from urllib.parse import urljoin
from ..security import MediaError, public_url
from ..models import Format, format_id


def attributes(line):
    return {k: v[1:-1] if v.startswith('"') else v for k, v in re.findall(r'([A-Z0-9-]+)=("[^"]*"|[^,]*)', line)}


def lines_of(text):
    lines = [x.strip() for x in text.lstrip('\ufeff').splitlines() if x.strip()]
    if not lines or lines[0] != '#EXTM3U':
        raise MediaError('bad_hls', 'The HLS response is not a playlist.')
    for line in lines:
        if line.startswith(('#EXT-X-KEY:', '#EXT-X-SESSION-KEY:')) and attributes(line).get('METHOD') != 'NONE':
            raise MediaError('encrypted_stream', 'This encrypted media representation is not supported.')
    return lines


def formats(text, url):
    lines = lines_of(text)
    audio = {}
    for line in lines:
        if line.startswith('#EXT-X-MEDIA:'):
            a = attributes(line)
            if a.get('TYPE') == 'AUDIO' and a.get('URI'):
                audio.setdefault(a.get('GROUP-ID'), public_url(urljoin(url, a['URI'])))
    result = []
    for i, line in enumerate(lines):
        if not line.startswith('#EXT-X-STREAM-INF:'):
            continue
        a = attributes(line)
        if i + 1 >= len(lines) or lines[i+1].startswith('#'):
            raise MediaError('bad_hls', 'The HLS variant has no media playlist.')
        target = public_url(urljoin(url, lines[i+1]))
        res = a.get('RESOLUTION', '').split('x')
        width, height = (int(res[0]), int(res[1])) if len(res) == 2 and all(x.isdigit() for x in res) else (None, None)
        codecs = a.get('CODECS', '').split(',')
        result.append(Format(format_id('hls', target), 'mp4', 'hls', {'url': target, 'audio': audio.get(a.get('AUDIO'))},
                             label=f'{height}p' if height else 'HLS original', width=width, height=height,
                             bitrate=int(a.get('AVERAGE-BANDWIDTH') or a.get('BANDWIDTH') or 0) or None,
                             video_codec=codecs[0] or None, audio_codec=codecs[1] if len(codecs)>1 else None))
    if not result:
        if '#EXT-X-ENDLIST' not in lines:
            raise MediaError('live_stream', 'Live HLS playlists are not supported; use a completed recording.')
        result = [Format(format_id('hls', url), 'mp4', 'hls', {'url': url, 'audio': None}, label='HLS original')]
    return result[:32]


def media_plan(text, url, maximum=3000):
    lines = lines_of(text)
    if '#EXT-X-ENDLIST' not in lines:
        raise MediaError('live_stream', 'Only completed HLS recordings can be downloaded.')
    if any(x.startswith(('#EXT-X-STREAM-INF', '#EXT-X-PART', '#EXT-X-GAP', '#EXT-X-DISCONTINUITY')) for x in lines):
        raise MediaError('unsupported_hls', 'This HLS playlist layout is not supported.')
    records, init, pending_range, offset, previous = [], None, None, 0, None
    duration = 0.0
    for line in lines:
        if line.startswith('#EXT-X-MAP:'):
            a = attributes(line)
            if not a.get('URI'):
                raise MediaError('bad_hls', 'Missing HLS initialization file.')
            candidate = {'url': public_url(urljoin(url, a['URI'])), 'range': None}
            if a.get('BYTERANGE'):
                n, at = a['BYTERANGE'].split('@') if '@' in a['BYTERANGE'] else (a['BYTERANGE'], '0')
                candidate['range'] = (int(at), int(at)+int(n)-1)
            if init and init != candidate:
                raise MediaError('unsupported_hls', 'Changing HLS initialization files are not supported.')
            init = candidate
        elif line.startswith('#EXTINF:'):
            duration += float(line.split(':', 1)[1].split(',')[0])
        elif line.startswith('#EXT-X-BYTERANGE:'):
            pending_range = line.split(':', 1)[1]
        elif not line.startswith('#'):
            target = public_url(urljoin(url, line))
            r = None
            if pending_range:
                parts = pending_range.split('@')
                n = int(parts[0])
                if len(parts) > 1:
                    offset = int(parts[1])
                elif previous != target:
                    raise MediaError('bad_hls', 'Missing first segment byte offset.')
                if n <= 0 or offset < 0:
                    raise MediaError('bad_hls', 'Invalid segment byte range.')
                r = (offset, offset+n-1)
                offset += n
            records.append({'url': target, 'range': r})
            previous, pending_range = target, None
            if len(records) > maximum:
                raise MediaError('segment_limit', 'This recording has too many media segments.')
    if not records:
        raise MediaError('bad_hls', 'The playlist contains no media segments.')
    return {'segments': records, 'init': init, 'duration': duration}
