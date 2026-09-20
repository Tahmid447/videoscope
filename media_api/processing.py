"""FFmpeg receives only vetted local media, never caller-controlled network URLs."""
import asyncio
import json
import logging
from pathlib import Path
import shutil
from .security import MediaError
from .network import signature
from .providers.hls import media_plan

log = logging.getLogger('videoscope.media')


async def command(args, timeout=90):
    proc = await asyncio.create_subprocess_exec(*args, stdin=asyncio.subprocess.DEVNULL,
                                               stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    async def capped(stream, maximum):
        parts, total = [], 0
        while chunk := await stream.read(16384):
            total += len(chunk)
            if total > maximum:
                raise MediaError('process_output_limit','Media processing produced an oversized diagnostic response.',502)
            parts.append(chunk)
        return b''.join(parts)
    try:
        async with asyncio.timeout(timeout):
            out, err = await asyncio.gather(capped(proc.stdout,2_000_000),capped(proc.stderr,128_000))
            await proc.wait()
        if proc.returncode:
            log.info('media_process command=%s exit=%s',Path(args[0]).name,proc.returncode)
            raise MediaError('processing_failed','Video processing or validation failed.',502)
        return out
    except BaseException:
        if proc.returncode is None:
            proc.kill()
        await proc.wait()
        raise


async def probe(path, settings):
    raw = await command(['ffprobe','-v','error','-protocol_whitelist','file','-format_whitelist','mov,matroska,webm,mpegts,aac,mp3,ogg','-show_format','-show_streams','-of','json',str(path)])
    data = json.loads(raw)
    video = [s for s in data.get('streams',[]) if s.get('codec_type')=='video' and s.get('width',0)>0]
    try:
        seconds = float(data.get('format',{}).get('duration',0))
    except (ValueError,TypeError):
        seconds = 0
    if not video or seconds <= 0:
        raise MediaError('not_video','The retrieved file is not a playable video.',502)
    if seconds > settings.max_duration:
        raise MediaError('duration_limit','The video exceeds the configured duration limit.',413)
    if path.stat().st_size > settings.max_file_bytes:
        raise MediaError('size_limit','The final video exceeds the configured size limit.',413)
    await command(['ffmpeg','-nostdin','-v','error','-protocol_whitelist','file','-format_whitelist','mov,matroska,webm,mpegts,aac,mp3,ogg','-i',str(path),'-t','0.25','-f','null','-'])
    return {'duration':seconds,'bytes':path.stat().st_size,'width':video[0]['width'],'height':video[0]['height'],
            'videoCodec':video[0].get('codec_name'),'audioCodec':next((s.get('codec_name') for s in data.get('streams',[]) if s.get('codec_type')=='audio'),None),
            'container':data.get('format',{}).get('format_name')}


async def prepare(analysis, fmt, directory, settings, progress):
    http, plan = analysis.http, fmt.plan
    referer = plan.get('referer') or analysis.url
    result = directory / ('video.'+fmt.extension)
    downloaded = 0

    async def join_parts(records, target):
        nonlocal downloaded
        with target.open('wb') as out:
            for i, rec in enumerate(records):
                part = directory / 'current.part'
                before = downloaded
                def tick(n, total):
                    progress('retrieving',before+n,None,i,len(records))
                n, _ = await http.save(rec['url'],part,limit=settings.max_file_bytes-downloaded,
                                       progress=tick,referer=referer,byte_range=rec.get('range'))
                downloaded += n
                with part.open('rb') as inp:
                    shutil.copyfileobj(inp,out,65536)
                part.unlink()
        return target

    if fmt.stream_type=='direct':
        def tick(n,total):
            progress('retrieving',n,total,None,None)
        n, head = await http.save(plan['url'],result,limit=settings.max_file_bytes,progress=tick,referer=plan.get('referer'))
        if signature(head) is None:
            raise MediaError('not_media','The downloaded response is not recognized media.',502)
    else:
        tracks = []
        if fmt.stream_type=='hls':
            for idx, url in enumerate(filter(None,[plan['url'],plan.get('audio')])):
                body, final, _ = await http.read(url,referer=referer)
                parsed = media_plan(body.decode('utf-8-sig'),final,settings.max_segments)
                if parsed['duration'] > settings.max_duration:
                    raise MediaError('duration_limit','This recording exceeds the duration limit.',413)
                recs = ([parsed['init']] if parsed['init'] else []) + parsed['segments']
                tracks.append(await join_parts(recs,directory/f'track{idx}.media'))
        elif fmt.stream_type=='dash':
            for idx, urls in enumerate(filter(None,[plan['video'],plan.get('audio')])):
                tracks.append(await join_parts([{'url':u,'range':None} for u in urls],directory/f'track{idx}.media'))
        else:
            raise MediaError('unsupported_format','The selected format is unavailable.')
        progress('finishing',downloaded,None,None,None)
        args = ['ffmpeg','-nostdin','-v','error','-y']
        for track in tracks:
            args += ['-protocol_whitelist','file','-format_whitelist','mov,matroska,webm,mpegts,aac,mp3,ogg','-i',str(track)]
        args += ['-map','0:v:0','-map','1:a:0' if len(tracks)>1 else '0:a?','-c','copy']
        if fmt.extension=='mp4':
            args += ['-movflags','+faststart']
        args += ['-fs',str(settings.max_file_bytes+1),str(result)]
        await command(args,timeout=min(settings.job_timeout,300))
    progress('validating',result.stat().st_size,result.stat().st_size,None,None)
    verified = await probe(result,settings)
    for child in directory.iterdir():
        if child != result:
            child.unlink(missing_ok=True)
    return result,verified
