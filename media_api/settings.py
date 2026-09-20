from dataclasses import dataclass, field
from pathlib import Path
import os


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("VIDEOSCOPE_DATA_DIR", "/tmp/videoscope-media")))
    access_key: str = field(default_factory=lambda: os.getenv("VIDEOSCOPE_ACCESS_KEY", ""))
    secret_key: str = field(default_factory=lambda: os.getenv("VIDEOSCOPE_SECRET_KEY", ""))
    origins: tuple[str, ...] = field(default_factory=lambda: tuple(x.strip().rstrip("/") for x in os.getenv("VIDEOSCOPE_ALLOWED_ORIGINS", "https://videoscope-3-tahmid.netlify.app").split(",") if x.strip()))
    allowed_hosts: tuple[str, ...] = field(default_factory=lambda: tuple(x.strip().lower() for x in os.getenv("VIDEOSCOPE_SOURCE_HOSTS", "").split(",") if x.strip()))
    max_file_bytes: int = field(default_factory=lambda: int(os.getenv("VIDEOSCOPE_MAX_FILE_BYTES", "1073741824")))
    disk_budget_bytes: int = field(default_factory=lambda: int(os.getenv("VIDEOSCOPE_DISK_BUDGET_BYTES", "4294967296")))
    concurrency: int = field(default_factory=lambda: int(os.getenv("VIDEOSCOPE_CONCURRENCY", "1")))
    max_jobs: int = 20
    job_timeout: int = field(default_factory=lambda: int(os.getenv("VIDEOSCOPE_JOB_TIMEOUT", "1200")))
    retention: int = field(default_factory=lambda: int(os.getenv("VIDEOSCOPE_RETENTION_SECONDS", "3600")))
    max_duration: int = 7200
    analysis_ttl: int = 900
    session_ttl: int = 3600
    ticket_ttl: int = 900
    max_segments: int = 10000

    def validate(self) -> None:
        if len(self.access_key) < 20 or len(self.secret_key) < 32:
            raise RuntimeError("Set VIDEOSCOPE_ACCESS_KEY (20+ characters) and VIDEOSCOPE_SECRET_KEY (32+ characters).")
        if not self.origins or "*" in self.origins:
            raise RuntimeError("Configure exact frontend origins; wildcard origins are not accepted.")
        if self.max_file_bytes < 1024 or self.disk_budget_bytes < self.max_file_bytes * 3:
            raise RuntimeError("Disk budget must reserve at least three times the maximum file size for processing.")
        if not 1 <= self.concurrency <= 4 or not 60 <= self.retention <= 86400:
            raise RuntimeError("Invalid worker concurrency or retention setting.")
