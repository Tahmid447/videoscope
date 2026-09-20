from contextlib import asynccontextmanager
from .app import create_app as original_app
from .collections import install
from .settings import Settings


def create_app(settings=None, http_factory=None):
    settings = settings or Settings()
    app = original_app(settings, http_factory)
    collections = install(app, settings)
    original_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(app):
        async with original_lifespan(app):
            try:
                yield
            finally:
                await collections.close()
    app.router.lifespan_context = lifespan
    return app
