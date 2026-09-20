"""Provider entry point. No arbitrary JavaScript, shell, or private session import."""
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, unquote
import json
import re
from ..models import Format, Analysis, format_id
from ..security import MediaError, public_url
from ..network import signature
from . import hls, dash


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta, self.sources, self.schema = {}, [], []
        self.title, self._title, self._script, self._text = '', False, False, ''

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'meta':
            self.meta[a.get('property') or a.get('name') or ''] = a.get('content','')
        if tag in ('video','source') and a.get('src'):
            self.sources.append((a['src'],a.get('type',''),a.get('label') or a.get('title') or 'Original'))
        if tag == 'video' and a.get('poster'):
            self.meta.setdefault('og:image',a['poster'])
        if tag == 'a' and a.get('href') and re.search(r'\.(mp4|webm|m3u8|mpd)(\?|$)', a['href'], re.I):
            self.sources.append((a['href'],'','Original'))
        if tag == 'title':
            self._title = True
        if tag == 'script' and a.get('type') == 'application/ld+json':
            self._script, self._text = True, ''

    def handle_data(self, text):
        if self._title:
            self.title += text
        if self._script:
            self._text += text

    def handle_endtag(self, tag):
        if tag == 'title':
            self._title = False
        if tag == 'script' and self._script:
            try:
                self.schema.append(json.loads(self._text))
            except ValueError:
                pass
            self._script = False


def json_videos(data):
    stack, found = list(data), []
    for _ in range(1000):
        if not stack:
            break
        x = stack.pop()
        if isinstance(x, list):
            stack.extend(x)
        elif isinstance(x, dict):
            types = x.get('@type',[])
            if 'VideoObject' in ([types] if isinstance(types,str) else types):
                found.append(x)
            stack.extend(v for v in x.values() if isinstance(v,(dict,list)))
    return found


def size_of(headers):
    if headers.get('Content-Range'):
        v = headers['Content-Range'].split('/')[-1]
    else:
        v = headers.get('Content-Length','')
    return int(v) if v.isdigit() else None


async def media_formats(http, url, settings, referer=None):
    prefix, final, headers = await http.inspect(url, referer)
    typ = signature(prefix)
    if typ:
        return [Format(format_id('file',url),typ,'direct',{'url':url,'referer':referer},filesize=size_of(headers))]
    text = prefix.decode('utf-8','replace')
    ct = headers.get('Content-Type','').lower()
    path = urlsplit(final).path.lower()
    if text.lstrip().startswith('#EXTM3U') or 'mpegurl' in ct or path.endswith('.m3u8'):
        body, final, _ = await http.read(final,referer=referer)
        found = hls.formats(body.decode('utf-8-sig'),final)
    elif '<MPD' in text or 'dash+xml' in ct or path.endswith('.mpd'):
        body, final, _ = await http.read(final,referer=referer)
        found = dash.parse(body,final,settings.max_segments,settings.max_duration)
    else:
        raise MediaError('no_stream','No supported video stream was detected in this response.')
    for f in found:
        f.plan['referer'] = referer
    return found


async def analyze_generic(http, url, owner, ident, settings):
    url = public_url(url,settings.allowed_hosts)
    prefix, final, headers = await http.inspect(url)
    if signature(prefix) or prefix.lstrip().startswith(b'#EXTM3U') or b'<MPD' in prefix[:4096]:
        formats = await media_formats(http,final,settings)
        title = unquote(urlsplit(final).path.rsplit('/',1)[-1]) or 'Video'
        return Analysis(ident,owner,url,title,formats,http,provider=formats[0].stream_type)
    body, final, _ = await http.read(final)
    page = Page()
    page.feed(body.decode('utf-8','replace'))
    schemas = json_videos(page.schema)
    schema = schemas[0] if schemas else {}
    title = page.meta.get('og:title') or schema.get('name') or page.title.strip() or 'Video'
    sources = list(page.sources)
    for key in ('og:video:secure_url','og:video:url','og:video'):
        if page.meta.get(key):
            sources.append((page.meta[key],page.meta.get('og:video:type',''),'Original'))
    content = schema.get('contentUrl')
    for value in content if isinstance(content,list) else [content]:
        if isinstance(value,str):
            sources.append((value,schema.get('encodingFormat',''),'Original'))
    formats, seen, warnings = [], set(), []
    last_error = None
    for target, mime, label in sources[:16]:
        target = public_url(urljoin(final,target),settings.allowed_hosts)
        if target in seen:
            continue
        seen.add(target)
        try:
            found = await media_formats(http,target,settings,final)
            if len(found)==1 and label != 'Original':
                found[0].label = label
            formats.extend(found)
        except MediaError as exc:
            last_error = exc
            warnings.append(exc.message)
    if not formats:
        if last_error:
            raise last_error
        raise MediaError('no_stream','No supported media representation was published in this page. Embedded player-only and script-only sites may need a provider integration.')
    thumbnails = schema.get('thumbnailUrl') or []
    thumb = page.meta.get('og:image') or (thumbnails[0] if isinstance(thumbnails,list) and thumbnails else thumbnails if isinstance(thumbnails,str) else None)
    if thumb:
        thumb = public_url(urljoin(final,thumb),settings.allowed_hosts)
    views = None
    stats = schema.get('interactionStatistic',[])
    for stat in [stats] if isinstance(stats,dict) else stats:
        typ = str(stat.get('interactionType',''))
        if 'WatchAction' in typ or 'ViewAction' in typ:
            try:
                views = max(0,int(stat['userInteractionCount']))
            except (ValueError,KeyError,TypeError):
                pass
    author = schema.get('author') or {}
    return Analysis(ident,owner,url,str(title)[:600],formats[:32],http,thumbnail=thumb,
                    duration=dash.duration(schema.get('duration')) or None, uploader=author.get('name') if isinstance(author,dict) else str(author),
                    upload_date=schema.get('uploadDate') or page.meta.get('article:published_time'),views=views,warnings=list(dict.fromkeys(warnings)))


async def analyze(http, url, owner, ident, settings):
    from .bridge import provider_name, analyze_provider
    url = public_url(url, settings.allowed_hosts)
    if provider_name(url):
        return await analyze_provider(http, url, owner, ident, settings)
    try:
        return await analyze_generic(http, url, owner, ident, settings)
    except MediaError as exc:
        if exc.code != 'no_stream':
            raise
        return await analyze_provider(http, url, owner, ident, settings)
