"""Static DASH with SegmentTemplate/Timeline/List and separate audio-video."""
import math
import re
from urllib.parse import urljoin
from defusedxml import ElementTree as ET
from ..security import MediaError, public_url
from ..models import Format, format_id


def duration(value):
    m = re.fullmatch(r'PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?', value or '')
    return sum(float(x or 0)*k for x, k in zip(m.groups(), (3600,60,1))) if m else 0


def substitute(value, rep, number, time):
    value = value.replace('$$', '\x00')
    def sub(m):
        key, width = m.group(1), m.group(2)
        val = {'RepresentationID': rep.get('id', ''), 'Bandwidth': rep.get('bandwidth', ''), 'Number': number, 'Time': time}[key]
        return str(val).zfill(min(int(width), 12)) if width else str(val)
    value = re.sub(r'\$(RepresentationID|Bandwidth|Number|Time)(?:%0(\d+)d)?\$', sub, value)
    if '$' in value:
        raise MediaError('unsupported_dash', 'Unknown DASH URL template.')
    return value.replace('\x00', '$')


def parse(text, base, max_segments=3000, max_duration=7200):
    try:
        root = ET.fromstring(text)
    except Exception:
        raise MediaError('bad_dash', 'The DASH response is not a valid manifest.') from None
    for el in root.iter():
        el.tag = el.tag.split('}')[-1]
    if root.tag != 'MPD' or root.get('type', 'static') != 'static':
        raise MediaError('live_stream', 'Only completed static DASH recordings are supported.')
    if root.find('.//ContentProtection') is not None:
        raise MediaError('encrypted_stream', 'Encrypted or DRM media representations are not supported.')
    periods = root.findall('Period')
    if len(periods) != 1:
        raise MediaError('unsupported_dash', 'This multi-period DASH layout is not supported.')
    period = periods[0]
    seconds = duration(period.get('duration') or root.get('mediaPresentationDuration'))
    if seconds > max_duration:
        raise MediaError('duration_limit', 'This recording exceeds the duration limit.')
    tracks = []
    for group in period.findall('AdaptationSet'):
        for rep in group.findall('Representation'):
            nodes = [root, period, group, rep]
            url = base
            for node in nodes:
                child = node.find('BaseURL')
                if child is not None and child.text:
                    url = public_url(urljoin(url, child.text.strip()))
            mime = rep.get('mimeType') or group.get('mimeType') or ''
            kind = rep.get('contentType') or group.get('contentType') or mime.split('/')[0]
            if kind not in ('audio','video'):
                continue
            template, seglist = None, None
            for node in nodes:
                if node.find('SegmentTemplate') is not None:
                    template = node.find('SegmentTemplate')
                if node.find('SegmentList') is not None:
                    seglist = node.find('SegmentList')
            urls = []
            if seglist is not None:
                init = seglist.find('Initialization')
                if init is not None and init.get('sourceURL'):
                    urls.append(public_url(urljoin(url, init.get('sourceURL'))))
                for seg in seglist.findall('SegmentURL'):
                    if seg.get('mediaRange'):
                        raise MediaError('unsupported_dash', 'DASH SegmentList byte ranges are not supported.')
                    urls.append(public_url(urljoin(url, seg.get('media', ''))))
            elif template is not None:
                timescale = int(template.get('timescale', '1'))
                number = int(template.get('startNumber', '1'))
                if timescale <= 0:
                    raise MediaError('bad_dash', 'Invalid DASH timescale.')
                init = template.get('initialization')
                if init:
                    urls.append(public_url(urljoin(url, substitute(init, rep.attrib, number, 0))))
                pattern = template.get('media')
                if not pattern:
                    raise MediaError('bad_dash', 'DASH representation has no media template.')
                timeline = template.find('SegmentTimeline')
                points = []
                if timeline is not None:
                    cursor = 0
                    spans = timeline.findall('S')
                    for idx, span in enumerate(spans):
                        cursor = int(span.get('t', cursor))
                        d = int(span.get('d', '0'))
                        repeat = int(span.get('r', '0'))
                        if d <= 0:
                            raise MediaError('bad_dash', 'Invalid DASH timeline duration.')
                        if repeat == -1:
                            end = int(spans[idx+1].get('t')) if idx+1 < len(spans) and spans[idx+1].get('t') else int(seconds*timescale)
                            if end <= cursor:
                                raise MediaError('unsupported_dash', 'Unbounded DASH timeline.')
                            repeat = math.ceil((end-cursor)/d)-1
                        if repeat < 0 or len(points)+repeat+1 > max_segments:
                            raise MediaError('segment_limit', 'Too many DASH segments.')
                        for _ in range(repeat+1):
                            points.append(cursor)
                            cursor += d
                else:
                    d = int(template.get('duration', '0'))
                    if d <= 0 or seconds <= 0:
                        raise MediaError('unsupported_dash', 'DASH duration is not provided.')
                    count = math.ceil(seconds*timescale/d)
                    if count > max_segments:
                        raise MediaError('segment_limit', 'Too many DASH segments.')
                    points = [i*d for i in range(count)]
                for i, time in enumerate(points):
                    urls.append(public_url(urljoin(url, substitute(pattern, rep.attrib, number+i, time))))
            elif url != base and not url.endswith('/'):
                urls = [public_url(url)]
            else:
                raise MediaError('unsupported_dash', 'Unsupported DASH segment layout.')
            if not urls or len(urls) > max_segments+1:
                raise MediaError('segment_limit', 'Invalid DASH segment count.')
            tracks.append({'id':rep.get('id',''), 'kind':kind, 'urls':urls, 'height':int(rep.get('height') or group.get('height') or 0) or None,
                           'width':int(rep.get('width') or group.get('width') or 0) or None, 'codec':rep.get('codecs') or group.get('codecs'),
                           'bitrate':int(rep.get('bandwidth','0')) or None, 'mime':mime})
    videos = [t for t in tracks if t['kind']=='video']
    audio = sorted((t for t in tracks if t['kind']=='audio'),key=lambda t:t['bitrate'] or 0,reverse=True)
    result = []
    for v in videos[:32]:
        a = audio[0] if audio else None
        ext = 'webm' if 'webm' in v['mime'] else 'mp4'
        result.append(Format(format_id('dash',base+v['id']),ext,'dash',{'video':v['urls'],'audio':a['urls'] if a else [],'url':base},
                             label=f"{v['height']}p" if v['height'] else 'DASH original',width=v['width'],height=v['height'],
                             bitrate=(v['bitrate'] or 0)+(a['bitrate'] or 0 if a else 0),video_codec=v['codec'],audio_codec=a['codec'] if a else None))
    if not result:
        raise MediaError('no_stream','No supported video representation was detected.')
    return result
