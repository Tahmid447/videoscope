from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any
import hashlib
import time


@dataclass
class Format:
    id: str
    extension: str
    stream_type: str
    plan: dict[str, Any]
    label: str = "Original"
    width: int | None = None
    height: int | None = None
    filesize: int | None = None
    bitrate: int | None = None
    video_codec: str | None = None
    audio_codec: str | None = None

    def public(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if k != "plan"}


@dataclass
class Analysis:
    id: str
    owner: str
    url: str
    title: str
    formats: list[Format]
    http: Any
    thumbnail: str | None = None
    duration: float | None = None
    uploader: str | None = None
    upload_date: str | None = None
    views: int | None = None
    provider: str = "generic"
    warnings: list[str] = field(default_factory=list)
    created: float = field(default_factory=time.time)
    busy: bool = False

    def public(self) -> dict:
        return {"analysisId": self.id, "title": self.title, "url": self.url, "thumbnail": self.thumbnail,
                "duration": self.duration, "uploader": self.uploader, "uploadDate": self.upload_date,
                "views": self.views, "provider": self.provider, "warnings": self.warnings,
                "formats": [f.public() for f in self.formats]}


def format_id(kind: str, value: str) -> str:
    return kind + "-" + hashlib.sha256(value.encode()).hexdigest()[:16]
