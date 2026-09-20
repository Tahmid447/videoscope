from contextlib import asynccontextmanager
from pathlib import Path
import asyncio
import hmac
import json
import logging
import secrets
import shutil
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from . import VERSION
from .settings import Settings
from .security import MediaError, Tokens, RateLimit, filename, disposition, public_url
from .network import SafeHTTP
from .providers import analyze
from .jobs import Manager


class LeasedFile(FileResponse):
    def __init__(self,job,**kwargs):
        self.job = job
        super().__init__(job.path,**kwargs)

    async def __call__(self,scope,receive,send):
        self.job.readers += 1
        try:
            await super().__call__(scope,receive,send)
        finally:
            self.job.readers -= 1


async def payload(request):
    data = bytearray()
    async for part in request.stream():
        data.extend(part)
        if len(data)>8192:
            raise MediaError('body_too_large','The request is too large.',413)
    try:
        value = json.loads(data or b'{}')
        if not isinstance(value,dict):
            raise ValueError()
        return value
    except ValueError:
        raise MediaError('invalid_json','Send a JSON object.') from None


def create_app(settings=None, http_factory=None):
    s = settings or Settings()
    s.validate()
    manager, tokens, limits = Manager(s),Tokens(s.secret_key),RateLimit()
    gate = asyncio.Semaphore(3)

    @asynccontextmanager
    async def lifespan(app):
        for name in ('ffmpeg','ffprobe'):
            if not shutil.which(name):
                raise RuntimeError(f'{name} is required on this server.')
        await manager.start()
        yield
        await manager.close()

    app = FastAPI(title='VideoScope Media API',version=VERSION,lifespan=lifespan,docs_url=None,redoc_url=None)
    app.state.manager = manager
    app.add_middleware(CORSMiddleware,allow_origins=list(s.origins),allow_methods=['GET','POST','DELETE','HEAD'],
                       allow_headers=['Authorization','Content-Type','Range'],expose_headers=['Content-Disposition','Content-Length','Content-Range','Accept-Ranges'])

    @app.exception_handler(MediaError)
    async def media_error(request,e):
        return JSONResponse({'error':{'code':e.code,'message':e.message,'upstreamStatus':e.upstream_status}},status_code=e.status)

    @app.exception_handler(Exception)
    async def unexpected_error(request,e):
        logging.getLogger('videoscope.media').error('request_failed error_type=%s',type(e).__name__)
        return JSONResponse({'error':{'code':'internal_error','message':'The media service could not complete this request.'}},status_code=500)

    @app.middleware('http')
    async def headers(request,call_next):
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Frame-Options'] = 'DENY'
        return response

    def owner(request):
        auth = request.headers.get('Authorization','')
        if not auth.startswith('Bearer '):
            raise MediaError('sign_in','Connect to your media service first.',401)
        return tokens.verify(auth[7:],'session')['owner']

    @app.get('/health')
    async def health():
        return {'status':'ok','version':VERSION,'ffmpeg':bool(shutil.which('ffmpeg')),'ffprobe':bool(shutil.which('ffprobe'))}

    @app.post('/api/session')
    async def session(request:Request):
        limits.check('login:'+(request.client.host if request.client else 'unknown'),10)
        b = await payload(request)
        key = b.get('accessKey')
        if not isinstance(key,str) or not hmac.compare_digest(key,s.access_key):
            raise MediaError('sign_in','The media service access key is incorrect.',401)
        ident = secrets.token_hex(16)
        return {'token':tokens.issue('session',ident,3600),'expiresIn':3600,'maxFileBytes':s.max_file_bytes,'version':VERSION}

    @app.post('/api/analyze')
    async def analyze_url(request:Request):
        who = owner(request)
        limits.check('analyze:'+who,12)
        b = await payload(request)
        url = public_url(b.get('url',''),s.allowed_hosts)
        await manager.cleanup()
        if len(manager.analyses)>=100 or sum(a.owner==who for a in manager.analyses.values())>=10:
            raise MediaError('analysis_limit','Too many recent analyses. Wait for an earlier one to expire.',429)
        http = http_factory() if http_factory else SafeHTTP(s.allowed_hosts)
        await http.start()
        try:
            async with gate,asyncio.timeout(50):
                a = await analyze(http,url,who,secrets.token_hex(16),s)
            manager.analyses[a.id] = a
            return a.public()
        except TimeoutError:
            await http.close()
            raise MediaError('analysis_timeout','The source took too long to analyze.',504) from None
        except BaseException:
            await http.close()
            raise

    @app.post('/api/download')
    async def download(request:Request):
        who = owner(request)
        limits.check('jobs:'+who,8)
        b = await payload(request)
        a = manager.analysis(b.get('analysisId'),who)
        name = b.get('filename',a.title)
        if not isinstance(name,str) or len(name)>1000:
            raise MediaError('bad_filename','Use a shorter filename.')
        job = await manager.create(a,b.get('formatId'),name)
        return JSONResponse(job.public(),status_code=202)

    @app.get('/api/jobs/{ident}')
    async def job_status(ident:str,request:Request):
        return manager.job(ident,owner(request)).public()

    @app.delete('/api/jobs/{ident}')
    async def cancel(ident:str,request:Request):
        j = manager.job(ident,owner(request))
        if j.task and not j.task.done():
            j.task.cancel()
            await asyncio.gather(j.task,return_exceptions=True)
        elif j.readers:
            raise MediaError('download_busy','The file is currently being downloaded.',409)
        else:
            shutil.rmtree(s.data_dir/('job-'+ident),ignore_errors=True)
            j.status,j.stage,j.reserve = 'cancelled','cancelled',0
        return j.public()

    @app.post('/api/jobs/{ident}/ticket')
    async def ticket(ident:str,request:Request):
        who = owner(request)
        j = manager.job(ident,who)
        if j.status != 'ready' or not j.path or not j.path.is_file():
            raise MediaError('not_ready','This download is not ready.',409)
        b = await payload(request)
        name = b.get('filename',j.filename)
        if not isinstance(name,str) or len(name)>1000:
            raise MediaError('bad_filename','Use a shorter filename.')
        name = filename(name,j.path.suffix)
        t = tokens.issue('file',who,s.ticket_ttl,job=ident,filename=name)
        return {'downloadPath':f'/api/jobs/{ident}/file?ticket={t}','filename':name,'expiresIn':s.ticket_ttl}

    @app.api_route('/api/jobs/{ident}/file',methods=['GET','HEAD'])
    async def file(ident:str,request:Request):
        t = tokens.verify(request.query_params.get('ticket',''),'file')
        if t.get('job') != ident:
            raise MediaError('invalid_ticket','The download link does not match this file.',403)
        j = manager.job(ident,t['owner'])
        if j.status != 'ready' or not j.path or not j.path.is_file():
            raise MediaError('not_ready','This file is unavailable or has expired.',410)
        types = {'.mp4':'video/mp4','.webm':'video/webm','.mkv':'video/x-matroska','.ogg':'video/ogg'}
        return LeasedFile(j,media_type=types.get(j.path.suffix,'application/octet-stream'),
                          headers={'Content-Disposition':disposition(t['filename']),'Cache-Control':'private, no-store'})

    frontend = Path(__file__).resolve().parent.parent/'static'/'downloads'
    if frontend.exists():
        app.mount('/',StaticFiles(directory=frontend,html=True),name='downloader')
    return app
