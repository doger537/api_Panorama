"""Loopback-only demo entry point; production uses backend.app.main."""
import os
from urllib.parse import urlsplit
from fastapi import Request
from fastapi.responses import RedirectResponse, Response
from backend.app.main import create_app
from backend.app.auth import create_session, get_optional_session
from backend.app.config import settings
from backend.app.db import database
app = create_app()
@app.middleware('http')
async def local_studio(request: Request, call_next):
    user_id = os.getenv('TTK_LOCAL_STUDIO_USER_ID')
    if (not user_id or urlsplit(settings.app_origin).hostname != '127.0.0.1'
            or not request.client or request.client.host != '127.0.0.1'
            or request.headers.get('host') != urlsplit(settings.app_origin).netloc):
        return Response('Local studio only', status_code=403)
    path = request.url.path
    navigation = request.method == 'GET' and (path in ('/', '/login', '/studio') or path.startswith('/studio/'))
    if navigation and request.headers.get('sec-fetch-site') not in (None, 'none', 'same-origin'):
        return Response('Open the local studio directly', status_code=403)
    if navigation and path in ('/', '/login'):
        with database() as db:
            row = db.execute('SELECT id FROM maps WHERE owner_id=? ORDER BY updated_at DESC LIMIT 1', (user_id,)).fetchone()
        response = RedirectResponse('/studio/'+row['id'] if row else '/studio')
    else:
        response = await call_next(request)
    if navigation and get_optional_session(request.cookies.get('ttk_session')) is None:
        token, _, _ = create_session(user_id)
        response.set_cookie('ttk_session', token, httponly=True, secure=False, samesite='strict', max_age=settings.session_ttl_seconds, path='/')
    return response
