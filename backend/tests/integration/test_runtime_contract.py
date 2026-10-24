import copy
from pathlib import Path
import yaml
from jsonschema import Draft202012Validator
from backend.tests.integration.test_api_integration import api_client
from backend.tests.integration.test_audit_regressions import credentials, create


def json_schema(value):
    if isinstance(value, list): return [json_schema(item) for item in value]
    if not isinstance(value, dict): return value
    result = {key: json_schema(item) for key, item in value.items() if key != 'nullable'}
    if isinstance(result.get('exclusiveMinimum'), bool):
        if result.pop('exclusiveMinimum'): result['exclusiveMinimum'] = result.pop('minimum')
    if isinstance(result.get('exclusiveMaximum'), bool):
        if result.pop('exclusiveMaximum'): result['exclusiveMaximum'] = result.pop('maximum')
    return {'anyOf': [result, {'type':'null'}]} if value.get('nullable') else result


def validate(name, payload):
    contract = json_schema(yaml.safe_load((Path(__file__).parents[3] / 'CONTRACTS/openapi.yaml').read_text()))
    contract['$ref'] = f'#/components/schemas/{name}'
    Draft202012Validator(contract).validate(payload)


def test_real_http_responses_match_transport_contract(api_client):
    validate('Health', api_client.get('/healthz').json())
    validate('ApiError', api_client.get('/api/v1/maps').json())
    headers=credentials(api_client)
    validate('Session', api_client.get('/api/v1/auth/session').json())
    snap, headers=create(api_client,headers)
    validate('OrganizerMap', api_client.get(f"/api/v1/maps/{snap['id']}").json())
    validate('MapSummary', api_client.get('/api/v1/maps?limit=1&offset=0').json()[0])


def test_capture_media_public_and_route_http_contract(api_client):
    from uuid import uuid4
    from scripts.seed_demo import make_png_bytes
    headers = credentials(api_client)
    snap, save_headers = create(api_client, headers)
    path = f"/api/v1/maps/{snap['id']}"
    capture = api_client.post(path + '/captures', headers=headers,
        json={'title': 'Capture', 'x': 10, 'y': 10, 'hfov_hint_deg': 65})
    assert capture.status_code == 201
    validate('Capture', capture.json())
    asset = api_client.post(path + '/assets', headers=headers,
        files={'kind': (None, 'plan'), 'file': ('plan.png', make_png_bytes(40, 30), 'image/png')})
    assert asset.status_code == 201
    validate('AssetRef', asset.json())
    ids = [str(uuid4()) for _ in range(5)]
    doc = snap['document']
    doc.update(is_published=True, background_asset_id=asset.json()['id'],
        nodes=[{'id': ids[0], 'x': 10, 'y': 10}, {'id': ids[1], 'x': 20, 'y': 10}],
        edges=[{'id': ids[2], 'a': min(ids[:2]), 'b': max(ids[:2])}],
        pois=[{'id': ids[3], 'title': 'Entrance', 'description': '', 'category': 'entrance',
               'category_label': None, 'x': 10, 'y': 10, 'nav_node_id': ids[0]}])
    saved = api_client.put(path + '/document', headers=save_headers, json=doc)
    assert saved.status_code == 200
    validate('OrganizerMap', saved.json())
    public = api_client.get(f"/api/v1/public/maps/{snap['slug']}")
    validate('PublicMap', public.json())
    route = api_client.post(f"/api/v1/public/maps/{snap['slug']}/route", json={
        'revision': 2, 'from_node_id': ids[0], 'to_node_id': ids[1]})
    assert route.status_code == 200
    validate('RouteResponse', route.json())
    conflict = api_client.put(path + '/document', headers=save_headers, json=doc)
    assert conflict.status_code == 412
    validate('ApiError', conflict.json())
