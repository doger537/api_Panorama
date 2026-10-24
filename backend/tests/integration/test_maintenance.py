import sqlite3
import pytest
from backend.tests.integration.test_api_integration import api_client
from backend.tests.integration.test_audit_regressions import credentials, create
from backend.app.config import settings
from backend.app.maintenance import backup, restore, collect_orphans


def test_backup_restore_and_orphan_safety(api_client, tmp_path):
    headers=credentials(api_client);snap,_=create(api_client,headers)
    from scripts.seed_demo import make_png_bytes
    result=api_client.post(f"/api/v1/maps/{snap['id']}/assets",headers=headers,files={'kind':(None,'plan'),'file':('plan.png',make_png_bytes(40,30),'image/png')})
    assert result.status_code==201
    source=tmp_path/'backup';backup(source)
    destination=tmp_path/'restored';restore(source,destination)
    db=sqlite3.connect(destination/'database.sqlite')
    assert db.execute('SELECT id FROM maps').fetchone()[0]==snap['id'];db.close()
    assert len(list((destination/'media').rglob('*.webp')))==3
    with pytest.raises(ValueError):restore(source,destination)
    orphan=settings.media_path/'orphan';orphan.write_bytes(b'orphan')
    candidates=collect_orphans(grace_seconds=-1)
    assert candidates==['orphan'] and orphan.exists()
    collect_orphans(apply=True,grace_seconds=-1)
    assert not orphan.exists()
    assert len(list(settings.media_path.rglob('*.webp')))==3


@pytest.mark.parametrize('damage', ['missing', 'corrupt'])
def test_restore_rejects_incomplete_media_before_creating_destination(api_client, tmp_path, damage):
    headers = credentials(api_client)
    snap, _ = create(api_client, headers)
    from scripts.seed_demo import make_png_bytes
    response = api_client.post(f"/api/v1/maps/{snap['id']}/assets", headers=headers,
        files={'kind': (None, 'plan'), 'file': ('plan.png', make_png_bytes(40, 30), 'image/png')})
    assert response.status_code == 201
    source = tmp_path / 'backup'
    backup(source)
    media = next((source / 'media').rglob('*.webp'))
    if damage == 'missing':
        media.unlink()
    else:
        media.write_bytes(b'corrupt')
    destination = tmp_path / 'restored'
    with pytest.raises(ValueError, match='media missing or checksum'):
        restore(source, destination)
    assert not destination.exists()
