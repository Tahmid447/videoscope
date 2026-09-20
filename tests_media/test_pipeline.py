import asyncio
from dataclasses import replace
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import socket
import subprocess
import threading
import time
from urllib.parse import quote
import pytest
from fastapi.testclient import TestClient
from media_api.gateway import create_app
from media_api.network import SafeHTTP
from media_api.security import MediaError, Tokens, filename, public_ip, public_url
from media_api.settings import Settings
from media_api.worker import item


class FixtureResolver:
    def __init__(self, port):
        self.port = port
    async def resolve(self, host, port=0, family=socket.AF_UNSPEC):
        return [{'hostname': host, 'host': '127.0.0.1', 'port': self.port, 'family': socket.AF_INET, 'proto': 0, 'flags': 0}]
    async def close(self):
        pass


def fixture_server(folder):
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=192x108:rate=12',
                    '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac', '-movflags', '+faststart', str(folder/'sample.mp4')], check=True)
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(folder/'sample.mp4'), '-c', 'copy',
                    '-hls_time', '1', '-hls_playlist_type', 'vod', str(folder/'sample.m3u8')], check=True)
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(folder/'sample.mp4'), '-c', 'copy',
                    '-f', 'dash', str(folder/'sample.mpd')], check=True)
    subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',str(folder/'sample.mp4'),'-frames:v','1',str(folder/'thumb.png')],check=True)
    (folder/'sample.html').write_text('<title>Fixture video</title><video poster="/thumb.png"><source src="/sample.mp4" type="video/mp4"></video>')
    (folder/'bad.mp4').write_text('<!doctype html><html>Access denied</html>')
    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_GET(self):
            if self.path == '/forbidden':
                self.send_error(403)
            elif self.path == '/redirect-private':
                self.send_response(302)
                self.send_header('Location', 'http://127.0.0.1/secrets')
                self.end_headers()
            else:
                super().do_GET()
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(folder)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


@pytest.fixture(scope='module')
def source(tmp_path_factory):
    folder = tmp_path_factory.mktemp('media-fixture')
    server = fixture_server(folder)
    yield server, folder
    server.shutdown()
    server.server_close()


@pytest.fixture
def client(source, tmp_path):
    server, _ = source
    s = Settings(data_dir=tmp_path, access_key='test-access-key-which-is-not-production', secret_key='test-secret-key-which-is-not-production-at-all')
    app = create_app(s, http_factory=lambda: SafeHTTP(resolver=FixtureResolver(server.server_port)))
    with TestClient(app) as c:
        c.headers['Authorization'] = 'Bearer '+Tokens(s.secret_key).issue('session', 'owner-a', 600)
        yield c, app, s


def finish(client, job):
    deadline = time.monotonic()+30
    while job['status'] in ('queued', 'processing') and time.monotonic() < deadline:
        time.sleep(0.05)
        job = client.get('/api/jobs/'+job['jobId']).json()
    assert job['status'] == 'ready', job
    return job


@pytest.mark.parametrize('source_name', ['sample.html', 'sample.mp4', 'sample.m3u8', 'sample.mpd'])
def test_real_attachment_pipeline(client, tmp_path, source_name):
    c, app, s = client
    response = c.post('/api/analyze', json={'url': 'http://fixture.example/'+source_name})
    assert response.status_code == 200, response.text
    analysis = response.json()
    assert analysis['title'] and analysis['formats']
    fmt = analysis['formats'][0]
    named = '\u6771\u4eac Walk \U0001f33b.mp4'
    response = c.post('/api/download', json={'analysisId': analysis['analysisId'], 'formatId': fmt['id'], 'filename': named})
    assert response.status_code == 202, response.text
    job = finish(c, response.json())
    assert job['verified']['duration'] >= 2.9
    assert job['verified']['width'] == 192
    assert job['verified']['audioCodec']
    ticket = c.post('/api/jobs/'+job['jobId']+'/ticket', json={'filename': named}).json()
    response = c.get(ticket['downloadPath'])
    assert response.status_code == 200
    assert response.headers['Content-Type'].startswith('video/')
    assert 'attachment;' in response.headers['Content-Disposition']
    assert quote(named, safe='') in response.headers['Content-Disposition']
    assert int(response.headers['Content-Length']) == len(response.content) > 1000
    output = tmp_path/'download.mp4'
    output.write_bytes(response.content)
    assert response.content[4:8] == b'ftyp'
    checked = subprocess.run(['ffprobe','-v','error','-show_streams','-of','json',str(output)],capture_output=True,check=True)
    assert any(x['codec_type']=='video' for x in json.loads(checked.stdout)['streams'])
    subprocess.run(['ffmpeg','-v','error','-i',str(output),'-t','0.5','-f','null','-'],capture_output=True,check=True)
    partial = c.get(ticket['downloadPath'], headers={'Range': 'bytes=0-127'})
    assert partial.status_code == 206
    assert len(partial.content) == 128
    assert partial.headers['Content-Range'].startswith('bytes 0-127/')
    assert c.get(ticket['downloadPath'], headers={'Range': 'bytes=999999999-'}).status_code == 416
    # Issuing a new filename never reruns source analysis or download.
    ticket2 = c.post('/api/jobs/'+job['jobId']+'/ticket', json={'filename': 'Second name.mp4.mp4'}).json()
    assert ticket2['filename'] == 'Second name.mp4'
    assert c.get(ticket2['downloadPath']).content == response.content
    c.headers['Authorization'] = 'Bearer '+Tokens(s.secret_key).issue('session','other-owner',600)
    assert c.get('/api/jobs/'+job['jobId']).status_code == 404


@pytest.mark.parametrize('path,status', [('forbidden',403),('not-found',404)])
def test_upstream_errors_are_not_successful_downloads(client,path,status):
    c,_,_=client
    r=c.post('/api/analyze',json={'url':'http://fixture.example/'+path})
    assert r.status_code==502, r.text
    assert r.json()['error']['upstreamStatus']==status


def test_redirect_to_private_network_rejected(client):
    c,_,_=client
    r=c.post('/api/analyze',json={'url':'http://fixture.example/redirect-private'})
    assert r.status_code==400
    assert r.json()['error']['code']=='unsafe_url'


@pytest.mark.parametrize('url',['http://127.0.0.1','http://169.254.169.254/latest','http://[::1]','http://[::ffff:127.0.0.1]','file:///etc/passwd','https://user:pass@example.com','http://example.com:8080','http://metadata.google.internal','http://localhost'])
def test_unsafe_urls_rejected(url):
    with pytest.raises(MediaError):
        public_url(url)


def test_filename_boundaries():
    assert filename('../CON.mp4.mp4','mp4')=='video-CON.mp4'
    assert filename('\u6771\u4eac \U0001f33b.mp4','mp4')=='\u6771\u4eac \U0001f33b.mp4'
    assert '/' not in filename('a/b','mp4')
    assert len(filename('x'*500,'mp4').encode()) < 180


def test_token_tampering_and_expiry():
    tokens=Tokens('x'*40)
    t=tokens.issue('session','a',60)
    assert tokens.verify(t,'session')['owner']=='a'
    for bad in (t+'a',tokens.issue('session','a',-1)):
        with pytest.raises(MediaError):
            tokens.verify(bad,'session')


def test_source_precision_is_preserved():
    row=item({'url':'https://www.youtube.com/watch?v=example','title':'Example','view_count':0,'timestamp':1789689600,'duration':207},flat=True)
    assert row['views']==0
    assert row['date_precision']=='approximate'
    assert row['rating'] is None


def test_missing_values_not_invented():
    row=item({'url':'https://example.com/video/1','title':'Example'},flat=True)
    assert row['views'] is None and row['published_at'] is None and row['creator'] is None


def test_html_disguised_as_mp4_is_not_media(client, tmp_path):
    c, app, s = client
    # A known format is analyzed, then the controlled test source returns HTML instead of its file.
    r = c.post('/api/analyze', json={'url': 'http://fixture.example/sample.mp4'})
    assert r.status_code == 200
    a = r.json()
    internal = app.state.manager.analyses[a['analysisId']]
    internal.formats[0].plan['url'] = 'http://fixture.example/bad.mp4'
    r = c.post('/api/download', json={'analysisId': a['analysisId'], 'formatId': a['formats'][0]['id']})
    assert r.status_code == 202
    j = r.json()
    deadline = time.monotonic()+10
    while j['status'] in ('queued','processing') and time.monotonic()<deadline:
        time.sleep(0.05)
        j=c.get('/api/jobs/'+j['jobId']).json()
    assert j['status']=='failed', j
    assert j['error']['code']=='not_media'
    assert not (s.data_dir/('job-'+j['jobId'])).exists()
