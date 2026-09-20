"""Disk-checkpointed provider collections; independent of a browser's lifetime.

A single application process owns workers. Interrupted workers become resumable
on restart; resume re-enumerates the provider but retains/deduplicates saved rows.
Mount VIDEOSCOPE_DATA_DIR as a persistent volume for redeploy durability.
"""
import asyncio
import json
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from fastapi import Request
from .security import MediaError, public_url, Tokens, RateLimit
from .extraction import events, extract
from .worker import item
from .providers.bridge import provider_name

FIELDS = ('title', 'thumbnail_url', 'views', 'rating', 'published_at', 'duration_seconds')


def now():
    return datetime.now(timezone.utc).isoformat()


class Collections:
    def __init__(self, settings):
        self.settings = settings
        self.root = settings.data_dir / 'collections'
        self.root.mkdir(parents=True, exist_ok=True)
        self.jobs, self.tasks = {}, {}
        self.slots = asyncio.Semaphore(2)

    def save(self, data):
        path = self.root / (data['job']['id']+'.json')
        temp = path.with_suffix('.tmp')
        temp.write_text(json.dumps(data, ensure_ascii=True), encoding='utf-8')
        os.replace(temp, path)

    def get(self, ident, owner):
        if not ident.startswith('e-'):
            raise MediaError('not_found', 'Collection not found in this workspace.', 404)
        try:
            uuid.UUID(ident[2:])
            data = self.jobs.get(ident)
            if data is None:
                path = self.root / (ident+'.json')
                data = json.loads(path.read_text())
                if data['job']['status'] in ('queued', 'running'):
                    data['job'].update(status='stopped', can_resume=True, message='The worker restarted. Continue scan to resume saved results.')
                    self.save(data)
        except (ValueError, FileNotFoundError):
            raise MediaError('not_found', 'Collection not found in this workspace.', 404) from None
        if data['owner'] != owner:
            raise MediaError('not_found', 'Collection not found in this workspace.', 404)
        return data

    def public(self, data):
        return {k: v for k, v in data['job'].items() if k not in ('url', 'enrich')}

    def collection(self, data):
        j, c = data['job'], data['collection']
        c.update(item_count=len(c['items']), updated_at=j['updated_at'], scan_status=j['status'], coverage=j['coverage'],
                 expected_count=j['expected'], pages=j['pages'], metadata_coverage={f: sum(x.get(f) is not None for x in c['items']) for f in FIELDS})
        return c

    async def close(self):
        for task in self.tasks.values():
            task.cancel()
        await asyncio.gather(*self.tasks.values(), return_exceptions=True)

    async def run(self, data):
        j, c = data['job'], data['collection']
        rows = {x['id']: x for x in c['items']}
        completed = False
        try:
            async with self.slots:
                j.update(status='running', stage='listing', message='Reading the source provider and its continuation pages...')
                async for event in events(j['url'], 'collection', limit=j['record_limit']+1, timeout=3600):
                    kind = event.get('event')
                    if kind == 'header':
                        c['label'] = event.get('title') or c['label']
                        j['expected'] = event.get('expected')
                        c['provider'] = event.get('provider') or 'yt-dlp'
                    elif kind == 'item':
                        x = event['item']
                        if len(rows) >= j['record_limit'] and x['id'] not in rows:
                            j['coverage'] = 'record limit reached'
                            break
                        # Enriched detail data survives resumed listing enumeration.
                        rows[x['id']] = {**x, **rows.get(x['id'], {})}
                        c['items'] = list(rows.values())
                        j['items'] = len(rows)
                        j['message'] = f"Collected {len(rows):,} videos. Reading the remaining provider pages..."
                        j['revision'] += 1
                    elif kind == 'warning':
                        if event['message'] not in j['warnings'] and len(j['warnings']) < 10:
                            j['warnings'].append(event['message'])
                    elif kind == 'done':
                        completed = True
                    j['updated_at'] = now()
                    if kind != 'item' or len(rows) % 25 == 0:
                        self.save(data)
                if not rows:
                    raise MediaError('empty_collection', 'The provider returned no usable videos for this URL. Choose its Videos tab or a specific video.')
                if completed and j['expected'] is not None and len(rows) != j['expected']:
                    completed = False
                    j['coverage'] = 'source count mismatch'
                else:
                    j['coverage'] = ('provider pagination exhausted' if completed else 'record limit reached')
                self.save(data)
                if j['enrich']:
                    j['stage'] = 'details'
                    pending = [x for x in c['items'] if not x.get('detail_attempted_at')]
                    j['details_remaining'] = len(pending)
                    for x in pending:
                        j['message'] = f"{len(rows):,} videos collected. Reading individual details {j['details_checked']+1}..."
                        try:
                            d, _ = await extract(x['url'])
                            detail = item(d)
                            if detail:
                                for k, v in detail.items():
                                    if v is not None and k not in ('id', 'url'):
                                        x[k] = v
                        except MediaError:
                            j['details_failed'] += 1
                        x['detail_attempted_at'] = now()
                        j['details_checked'] += 1
                        j['details_remaining'] -= 1
                        j['updated_at'] = now()
                        self.save(data)
                        await asyncio.sleep(0.3)
                j.update(status='complete' if completed else 'partial', stage='finished', can_resume=not completed,
                         message=f"Collected {len(rows):,} unique videos. "+('Provider pagination finished.' if completed else 'Some source records remain unresolved; saved results can be continued.'))
        except asyncio.CancelledError:
            j.update(status='stopped', message='Scan paused. Saved results are preserved.', can_resume=True)
        except Exception as exc:
            j.update(status='partial' if rows else 'failed', message=exc.message if isinstance(exc, MediaError) else 'The provider worker failed. Saved records are preserved.',
                     coverage='provider request incomplete', can_resume=True)
        finally:
            j['updated_at'] = now()
            self.collection(data)
            self.save(data)
            self.jobs.pop(j['id'], None)
            self.tasks.pop(j['id'], None)

    def start(self, data):
        ident = data['job']['id']
        if ident in self.tasks:
            return
        if len(self.tasks) >= 4:
            raise MediaError('queue_full', 'The provider scan queue is full. Try again shortly.', 429)
        self.jobs[ident] = data
        self.tasks[ident] = asyncio.create_task(self.run(data))


def install(app, settings):
    manager = Collections(settings)
    app.state.provider_collections = manager
    tokens, limits = Tokens(settings.secret_key), RateLimit()

    def owner(request):
        auth = request.headers.get('authorization', '')
        if not auth.startswith('Bearer '):
            raise MediaError('sign_in', 'Open VideoScope to initialize your workspace.', 401)
        return tokens.verify(auth[7:], 'session')['owner']

    @app.post('/api/route')
    async def route(request: Request):
        who = owner(request)
        limits.check('route:'+who, 30)
        from .app import payload
        b = await payload(request)
        url = public_url(b.get('url', ''))
        name = provider_name(url)
        return {'provider': name, 'supported': bool(name)}

    @app.post('/api/scans')
    async def create_scan(request: Request):
        who = owner(request)
        limits.check('scan:'+who, 6)
        from .app import payload
        b = await payload(request)
        url = public_url(b.get('url', ''))
        if any(d['owner'] == who for d in manager.jobs.values()):
            raise MediaError('scan_busy', 'A scan is already running in this workspace. Pause it before starting another.', 409)
        if len(list(manager.root.glob('*.json'))) >= 100:
            raise MediaError('collection_limit', 'Saved provider collection storage is full. Remove an old collection first.', 413)
        ident, stamp = 'e-'+str(uuid.uuid4()), now()
        limit = 10000 if b.get('pages', 'all') == 'all' else min(10000, max(30, int(b.get('pages') or 25)*30))
        j = {'id': ident, 'collection_id': ident, 'url': url, 'version': '4.0.0', 'status': 'queued', 'stage': 'listing',
             'message': 'Provider scan queued.', 'expected': None, 'items': 0, 'pages': None, 'provider_worker': True, 'revision': 0, 'warnings': [],
             'details_checked': 0, 'details_remaining': 0, 'details_failed': 0, 'coverage': 'not started',
             'record_limit': limit, 'enrich': b.get('enrich') is True, 'retry_after_ms': 1500, 'can_resume': True, 'updated_at': stamp}
        c = {'id': ident, 'job_id': ident, 'input': url, 'label': 'Provider collection', 'created_at': stamp, 'updated_at': stamp,
             'version': '4.0.0', 'items': [], 'item_count': 0, 'pages': 0}
        data = {'owner': who, 'job': j, 'collection': c}
        manager.save(data)
        manager.start(data)
        return manager.public(data)

    @app.get('/api/scans/{ident}')
    async def get_scan(ident: str, request: Request):
        return manager.public(manager.get(ident, owner(request)))

    @app.post('/api/scans/{ident}/{action}')
    async def action_scan(ident: str, action: str, request: Request):
        data = manager.get(ident, owner(request))
        if action == 'stop' and ident in manager.tasks:
            task = manager.tasks[ident]
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        elif action == 'resume' and data['job']['status'] != 'complete':
            data['job'].update(status='queued', message='Continuing the saved provider collection.')
            manager.start(data)
        elif action not in ('step', 'resume', 'stop'):
            raise MediaError('not_found', 'Unknown scan operation.', 404)
        return manager.public(data)

    @app.get('/api/collections')
    async def list_collections(request: Request):
        who = owner(request)
        result = []
        for p in manager.root.glob('e-*.json'):
            try:
                data = manager.get(p.stem, who)
                result.append({k: v for k, v in manager.collection(data).items() if k != 'items'})
            except MediaError:
                continue
        return sorted(result, key=lambda c: c['updated_at'], reverse=True)

    @app.get('/api/collections/{ident}')
    async def get_collection(ident: str, request: Request):
        return manager.collection(manager.get(ident, owner(request)))

    @app.delete('/api/collections/{ident}')
    async def delete_collection(ident: str, request: Request):
        manager.get(ident, owner(request))
        if ident in manager.tasks:
            raise MediaError('busy', 'Pause this scan before removing the collection.', 409)
        (manager.root/(ident+'.json')).unlink(missing_ok=True)
        return {'ok': True}
    return manager
