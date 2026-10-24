from uuid import uuid4
from unittest.mock import patch
from backend.tests.integration.test_api_integration import api_client
from backend.app.auth import create_organizer


def credentials(client):
    create_organizer('audit@example.test', 'audit-password-2026')
    r = client.post('/api/v1/auth/login', json={'email':'audit@example.test','password':'audit-password-2026'}, headers={'Origin':'http://testserver'})
    return {'Origin':'http://testserver','X-CSRF-Token':r.json()['csrf_token']}


def create(client, headers):
    response = client.post('/api/v1/maps', headers=headers, json={'title':'Map','description':'','width_units':500,'height_units':500,'scale_m_per_unit':None,'max_walk_gap_units':100})
    return response.json()['snapshot'], {**headers,'If-Match':response.headers['ETag']}


def test_unknown_user_does_password_work(api_client):
    with patch('backend.app.routers.auth.verify_login_password', return_value=False) as verify:
        r=api_client.post('/api/v1/auth/login', json={'email':'absent@example.test','password':'audit-password-2026'}, headers={'Origin':'http://testserver'})
        assert r.status_code == 401
        verify.assert_called_once_with(None, 'audit-password-2026')


def test_parallel_login_reservations_keep_failures_and_release_only_successes():
    from backend.app.auth import check_login_rate_limit, release_successful_login, clear_login_failures
    from backend.app.errors import ApiError
    import pytest
    clear_login_failures()
    for _ in range(4):
        check_login_rate_limit('10.1.2.3', 'owner@example.test')
    success = check_login_rate_limit('10.1.2.3', 'owner@example.test')
    with pytest.raises(ApiError):
        check_login_rate_limit('10.1.2.3', 'owner@example.test')
    release_successful_login('10.1.2.3', 'owner@example.test', success)
    check_login_rate_limit('10.1.2.3', 'owner@example.test')
    with pytest.raises(ApiError):
        check_login_rate_limit('10.1.2.3', 'owner@example.test')
    clear_login_failures()


def test_self_crossing_polygon_rejected_without_revision_change(api_client):
    headers=credentials(api_client); snap, headers=create(api_client, headers)
    doc=snap['document'];doc['shapes']=[{'id':str(uuid4()),'kind':'room','label':'crossing','points':[{'x':0,'y':0},{'x':100,'y':100},{'x':0,'y':100},{'x':80,'y':0}]}]
    response=api_client.put(f"/api/v1/maps/{snap['id']}/document", json=doc, headers=headers)
    assert response.status_code == 422
    assert api_client.get(f"/api/v1/maps/{snap['id']}").json()['snapshot']['revision'] == 1


def test_cross_map_id_collision_is_a_client_error(api_client):
    auth=credentials(api_client); first,h1=create(api_client,auth); second,h2=create(api_client,auth)
    shape={'id':str(uuid4()),'kind':'wall','label':'wall','points':[{'x':1,'y':1},{'x':2,'y':2}]}
    for snap, headers, status in [(first,h1,200),(second,h2,422)]:
        doc=snap['document'];doc['shapes']=[shape]
        assert api_client.put(f"/api/v1/maps/{snap['id']}/document",json=doc,headers=headers).status_code == status
