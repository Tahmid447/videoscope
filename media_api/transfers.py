"""Download extracted tracks through pinned HTTP; remux vetted LOCAL files only."""
from .processing import command, probe
from .providers.hls import media_plan
from .security import MediaError
import shutil


async def prepare_extracted(analysis, fmt, directory, settings, progress):
    http, total_bytes = analysis.http, 0
    referer = fmt.plan.get('referer')
    tracks = []
    for i, track in enumerate(fmt.plan['tracks']):
        target = directory / f'input-{i}.media'
        if track['kind'] == 'hls':
            body, final, _ = await http.read(track['url'], referer=referer)
            parsed = media_plan(body.decode('utf-8-sig'), final, settings.max_segments)
            if parsed['duration'] > settings.max_duration:
                raise MediaError('duration_limit', 'The recording exceeds the configured duration limit.', 413)
            records = ([parsed['init']] if parsed['init'] else [])+parsed['segments']
        else:
            records = [{'url': track['url'], 'range': None}]
        with target.open('wb') as out:
            for index, rec in enumerate(records):
                part = directory / 'segment.part'
                before = total_bytes
                size, _ = await http.save(rec['url'], part, limit=settings.max_file_bytes-total_bytes,
                    progress=lambda n, total: progress('retrieving', before+n, fmt.filesize, index, len(records)),
                    referer=referer, byte_range=rec.get('range'))
                total_bytes += size
                with part.open('rb') as inp:
                    shutil.copyfileobj(inp, out, 65536)
                part.unlink()
        tracks.append(target)
    result = directory / ('video.'+fmt.extension)
    progress('finishing', total_bytes, fmt.filesize, None, None)
    args = ['ffmpeg', '-nostdin', '-v', 'error', '-y']
    for path in tracks:
        args += ['-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm,mpegts,aac,mp3,ogg', '-i', str(path)]
    args += ['-map', '0:v:0', '-map', '1:a:0' if len(tracks)>1 else '0:a?', '-c', 'copy']
    if fmt.extension == 'mp4':
        args += ['-movflags', '+faststart']
    args += ['-fs', str(settings.max_file_bytes+1), str(result)]
    await command(args, timeout=min(settings.job_timeout, 300))
    progress('validating', result.stat().st_size, result.stat().st_size, None, None)
    verified = await probe(result, settings)
    for path in directory.iterdir():
        if path != result:
            path.unlink(missing_ok=True)
    return result, verified
