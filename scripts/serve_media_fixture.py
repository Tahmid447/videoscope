"""Local CI fixture, not a production route or a public-URL bypass."""
from pathlib import Path
import tempfile,json,hashlib
from fastapi import Request
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
import uvicorn
from media_api.gateway import create_app
from media_api.settings import Settings
from media_api.network import SafeHTTP
from media_api.security import Tokens
from tests_media.test_pipeline import fixture_server, FixtureResolver
root=Path(tempfile.mkdtemp(prefix='videoscope-browser-'))
server=fixture_server(root)
s=Settings(data_dir=root/'jobs',access_key='local-fixture-access-key-only',secret_key='local-fixture-secret-not-used-in-production')
app=create_app(s,http_factory=lambda:SafeHTTP(resolver=FixtureResolver(server.server_port)))

@app.middleware('http')
async def test_bridge(request,call_next):
    if request.url.path.startswith('/api/media/'):
        path=request.url.path.replace('/api/media/','/api/',1)
        request.scope['path']=path
        request.scope['raw_path']=path.encode()
        request.scope['headers']=[(k,v) for k,v in request.scope['headers'] if k!=b'authorization']+[(b'authorization',('Bearer '+Tokens(s.secret_key).issue('session','fixture',600)).encode())]
        response=await call_next(request)
        if path.endswith('/ticket') and response.status_code==200:
            content=b''.join([part async for part in response.body_iterator])
            data=json.loads(content)
            data['downloadUrl']='http://127.0.0.1:8130'+data['downloadPath']
            return JSONResponse(data)
        return response
    return await call_next(request)

@app.get('/fixture')
async def page():
    return HTMLResponse('''<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/media.css"><script src="/media.js"></script><label>Video URL<input id="fixtureUrl" value="http://fixture.example/sample.html"></label><button id="analyze" onclick="VideoScopeMedia.open({url:document.getElementById('fixtureUrl').value})">Analyze</button>''')
@app.get('/media.js')
async def js(): return FileResponse('static/media.js',media_type='application/javascript')
@app.get('/media.css')
async def css(): return FileResponse('static/media.css',media_type='text/css')
uvicorn.run(app,host='127.0.0.1',port=8130,access_log=False)
