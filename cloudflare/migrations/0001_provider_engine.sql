PRAGMA foreign_keys = ON;
CREATE TABLE providers (id TEXT PRIMARY KEY, capabilities_json TEXT NOT NULL);
CREATE TABLE collections (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, input_url TEXT NOT NULL, provider TEXT NOT NULL,
 source_type TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 job_id TEXT NOT NULL, refresh_mode TEXT NOT NULL DEFAULT 'full'
);
CREATE INDEX collections_owner_url ON collections(owner, input_url, updated_at DESC);
CREATE TABLE scan_jobs (
 id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
 owner TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 next_run_at INTEGER NOT NULL DEFAULT 0, state_json TEXT NOT NULL
);
CREATE INDEX jobs_due ON scan_jobs(status, next_run_at, lease_until);
CREATE INDEX jobs_owner ON scan_jobs(owner, collection_id);
CREATE TABLE videos (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, source_video_id TEXT NOT NULL,
 canonical_url TEXT NOT NULL, title TEXT NOT NULL, description TEXT, uploader TEXT, uploader_search TEXT,
 published_at TEXT, views REAL, likes REAL, comments REAL, rating REAL, rating_scale REAL,
 duration_seconds REAL, height INTEGER, is_hd INTEGER, thumbnail_url TEXT,
 search_text TEXT NOT NULL, record_json TEXT NOT NULL, fetched_at TEXT NOT NULL,
 UNIQUE(provider, source_video_id)
);
CREATE INDEX videos_provider ON videos(provider);
CREATE INDEX videos_source_video ON videos(source_video_id);
CREATE INDEX videos_published ON videos(published_at);
CREATE INDEX videos_views ON videos(views);
CREATE INDEX videos_likes ON videos(likes);
CREATE INDEX videos_comments ON videos(comments);
CREATE INDEX videos_duration ON videos(duration_seconds);
CREATE INDEX videos_uploader ON videos(uploader);
CREATE TABLE collection_videos (
 collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
 video_id TEXT NOT NULL REFERENCES videos(id), enriched_at TEXT,
 PRIMARY KEY(collection_id, video_id)
);
CREATE INDEX membership_video ON collection_videos(video_id);
CREATE TABLE scan_checkpoints (
 scan_id TEXT NOT NULL REFERENCES scan_jobs(id) ON DELETE CASCADE,
 cursor_key TEXT NOT NULL, revision INTEGER NOT NULL, fingerprint TEXT,
 saved_at TEXT NOT NULL, PRIMARY KEY(scan_id, cursor_key)
);
CREATE INDEX checkpoint_fingerprint ON scan_checkpoints(scan_id, fingerprint);
CREATE TABLE provider_locks (id TEXT PRIMARY KEY, lease TEXT NOT NULL, lease_until INTEGER NOT NULL);
CREATE TABLE response_cache (cache_key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, response_json TEXT NOT NULL);
CREATE INDEX cache_expiry ON response_cache(expires_at);
CREATE TABLE rate_buckets (bucket TEXT PRIMARY KEY, requests INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE bookmarks (owner TEXT NOT NULL, video_id TEXT NOT NULL REFERENCES videos(id), PRIMARY KEY(owner,video_id));
