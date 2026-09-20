"""Single-process bounded queue; ephemeral files expire and users are isolated."""
import asyncio
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path
import logging
import secrets
import shutil
import time
from .models import Analysis
from .security import MediaError, filename
from .processing import prepare

log = logging.getLogger('videoscope.media')


@dataclass
class Job:
    id: str
    owner: str
    filename: str
    status: str = 'queued'
    stage: str = 'queued'
    bytes: int = 0
    total: int | None = None
    segments: int | None = None
    segment_total: int | None = None
    error: dict | None = None
    path: Path | None = None
    verified: dict | None = None
    created: float = field(default_factory=time.time)
    finished: float | None = None
    task: object = None
    readers: int = 0
    reserve: int = 0

    def public(self):
        return {'jobId':self.id,'status':self.status,'stage':self.stage,'bytes':self.bytes,'total':self.total,
                'percent':round(min(100,self.bytes/self.total*100),1) if self.total else None,
                'segments':self.segments,'segmentTotal':self.segment_total,'filename':self.filename,
                'error':self.error,'verified':self.verified}


class Manager:
    def __init__(self, settings):
        self.settings = settings
        self.jobs: dict[str,Job] = {}
        self.analyses: dict[str,Analysis] = {}
        self.slots = asyncio.Semaphore(settings.concurrency)
        self.cleanup_task = None

    async def start(self):
        self.settings.data_dir.mkdir(parents=True,exist_ok=True)
        for p in self.settings.data_dir.glob('job-*'):
            if p.is_dir() and not p.is_symlink():
                shutil.rmtree(p)
        self.cleanup_task = asyncio.create_task(self.clean_loop())

    async def close(self):
        if self.cleanup_task:
            self.cleanup_task.cancel()
            with suppress(asyncio.CancelledError):
                await self.cleanup_task
        tasks = [j.task for j in self.jobs.values() if j.task and not j.task.done()]
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks,return_exceptions=True)
        for a in self.analyses.values():
            await a.http.close()
        for j in self.jobs.values():
            shutil.rmtree(self.settings.data_dir/('job-'+j.id),ignore_errors=True)

    async def cleanup(self):
        now = time.time()
        for ident,j in list(self.jobs.items()):
            if j.finished and now-j.finished > self.settings.retention and j.readers==0:
                shutil.rmtree(self.settings.data_dir/('job-'+j.id),ignore_errors=True)
                self.jobs.pop(ident,None)
        for ident,a in list(self.analyses.items()):
            if now-a.created > self.settings.analysis_ttl and not a.busy:
                await a.http.close()
                self.analyses.pop(ident,None)

    async def clean_loop(self):
        while True:
            await asyncio.sleep(30)
            await self.cleanup()

    def analysis(self, ident, owner):
        a = self.analyses.get(ident)
        if not a or a.owner != owner:
            raise MediaError('not_found','Analysis not found in this session.',404)
        if time.time()-a.created > self.settings.analysis_ttl:
            raise MediaError('analysis_expired','The analysis has expired. Analyze the source again.',410)
        return a

    def job(self, ident, owner):
        j = self.jobs.get(ident)
        if not j or j.owner != owner:
            raise MediaError('not_found','Download not found in this session.',404)
        return j

    async def create(self, a, format_id, name):
        await self.cleanup()
        if a.busy:
            raise MediaError('busy','A download for this analysis is already being prepared.',409)
        fmt = next((f for f in a.formats if f.id==format_id),None)
        if not fmt:
            raise MediaError('invalid_format','The selected format is unavailable.')
        if fmt.filesize and fmt.filesize > self.settings.max_file_bytes:
            raise MediaError('size_limit','The requested video is larger than the configured limit.',413)
        if len(self.jobs)>=self.settings.max_jobs:
            raise MediaError('queue_full','The download queue is full. Try again after a job expires.',429)
        reserve = self.settings.max_file_bytes*3
        if sum(j.reserve for j in self.jobs.values())+reserve > self.settings.disk_budget_bytes:
            raise MediaError('storage_busy','Temporary download storage is busy. Try again after earlier downloads expire.',503)
        if shutil.disk_usage(self.settings.data_dir).free < reserve+16_000_000:
            raise MediaError('disk_full','The media server needs more temporary disk space.',503)
        j = Job(secrets.token_hex(16),a.owner,filename(name or a.title,fmt.extension),reserve=reserve)
        self.jobs[j.id] = j
        a.busy = True
        j.task = asyncio.create_task(self.run(j,a,fmt))
        return j

    async def run(self,j,a,fmt):
        folder = self.settings.data_dir/('job-'+j.id)
        def progress(stage,n,total,seg,segs):
            j.stage,j.bytes,j.total,j.segments,j.segment_total = stage,n,total,seg,segs
        try:
            async with self.slots:
                folder.mkdir(mode=0o700)
                j.status = 'processing'
                async with asyncio.timeout(self.settings.job_timeout):
                    j.path,j.verified = await prepare(a,fmt,folder,self.settings,progress)
                j.status,j.stage = 'ready','ready'
                j.bytes = j.total = j.path.stat().st_size
                j.reserve = j.bytes
                log.info('job_ready id=%s bytes=%s format=%s',j.id,j.bytes,fmt.stream_type)
        except asyncio.CancelledError:
            j.status,j.stage = 'cancelled','cancelled'
        except TimeoutError:
            j.status,j.stage = 'failed','failed'
            j.error = {'code':'job_timeout','message':'Video processing exceeded the time limit.'}
        except MediaError as e:
            j.status,j.stage = 'failed','failed'
            j.error = {'code':e.code,'message':e.message,'upstreamStatus':e.upstream_status}
            log.info('job_failed id=%s code=%s upstream=%s',j.id,e.code,e.upstream_status)
        except Exception as e:
            j.status,j.stage = 'failed','failed'
            j.error = {'code':'processing_failed','message':'Video processing failed.'}
            log.error('job_failed id=%s error_type=%s',j.id,type(e).__name__)
        finally:
            a.busy = False
            j.finished = time.time()
            if j.status != 'ready':
                j.reserve = 0
                shutil.rmtree(folder,ignore_errors=True)
