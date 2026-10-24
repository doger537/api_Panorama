"""Only used in a disposable E2E container: no production data or public credentials."""
import os
import subprocess
import uvicorn
from backend.app.db import initialize_database
from backend.app.auth import create_organizer
from backend.app.config import settings

initialize_database()
create_organizer(os.environ['E2E_EMAIL'], os.environ['E2E_PASSWORD'])
worker = subprocess.Popen(['python', '-m', 'backend.worker.main'])
try:
    uvicorn.run('backend.app.main:app', host='0.0.0.0', port=8000)
finally:
    worker.terminate()
    worker.wait(timeout=10)
