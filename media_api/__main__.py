import os
import logging
import uvicorn

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
# Do not log ticket URLs. One worker is required by the local queue/volume model.
uvicorn.run("media_api.app:create_app", factory=True, host="0.0.0.0", port=int(os.getenv("PORT", "8000")), workers=1, access_log=False)
