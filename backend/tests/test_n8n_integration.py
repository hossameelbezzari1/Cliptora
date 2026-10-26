import os
import subprocess
import sys
import textwrap


def test_n8n_link_lifecycle_and_service_auth(tmp_path):
    root = os.path.dirname(os.path.dirname(__file__))
    code = textwrap.dedent('''
        from app.main import app
        from app.core.database import Base, engine
        from app.api.v1 import n8n_api
        import base64, hashlib, hmac, json, time
        from urllib.parse import parse_qs, urlparse
        Base.metadata.create_all(engine)

        workflows = {}
        sequence = {'value': 0}
        def fake_n8n(method, path, payload=None):
            if method == 'POST' and path == '/workflows':
                sequence['value'] += 1
                identifier = f'wf-{sequence["value"]}'
                workflows[identifier] = {'id': identifier, 'name': payload['name'], 'nodes': payload['nodes'], 'connections': payload['connections'], 'settings': payload['settings'], 'active': False}
                return workflows[identifier]
            identifier = path.rsplit('/', 1)[-1]
            if method == 'GET': return workflows[identifier]
            if method == 'DELETE': workflows.pop(identifier); return None
            raise AssertionError((method, path))
        n8n_api.n8n_request = fake_n8n

        from fastapi.testclient import TestClient
        with TestClient(app) as client:
            csrf = client.get('/api/v1/auth/csrf').json()['csrf_token']
            headers = {'X-CSRF-Token': csrf}
            registered = client.post('/api/v1/auth/register', headers=headers, json={
                'display_name':'n8n Tester','email':'n8n@example.com',
                'password':'test-password-1234','password_confirmation':'test-password-1234'})
            assert registered.status_code == 201, registered.text
            editor_session = client.post('/api/v1/n8n/editor-session', headers=headers, json={
                'editor_path':'/n8n/workflow/wf-bridge-test'})
            assert editor_session.status_code == 200, editor_session.text
            session_url = editor_session.json()['url']
            assert session_url.startswith('/n8n/rest/cliptora-sso?token=')
            ticket = parse_qs(urlparse(session_url).query)['token'][0]
            encoded, signature = ticket.split('.')
            padding = '=' * (-len(signature) % 4)
            supplied = base64.urlsafe_b64decode(signature + padding)
            expected = hmac.new(b'test-sso-secret-that-is-longer-than-32-characters', encoded.encode(), hashlib.sha256).digest()
            assert hmac.compare_digest(supplied, expected)
            payload_padding = '=' * (-len(encoded) % 4)
            payload = json.loads(base64.urlsafe_b64decode(encoded + payload_padding))
            assert payload['next'] == '/n8n/workflow/wf-bridge-test'
            assert int(time.time()) < payload['exp'] <= int(time.time()) + 45
            invalid_session = client.post('/api/v1/n8n/editor-session', headers=headers, json={
                'editor_path':'https://attacker.example/'})
            assert invalid_session.status_code == 422
            project = client.post('/api/v1/projects', headers=headers, json={'name':'Film','width':1920,'height':1080,'fps':30})
            assert project.status_code == 201, project.text
            project_id = project.json()['id']
            timeline = client.get(f'/api/v1/projects/{project_id}/timeline').json()
            element_id = 'empty-workflow-element'
            timeline['tracks'][0]['clips'].append({
                'client_id': element_id, 'name':'Automation', 'type':'text', 'start':0,
                'duration':5, 'source_offset':0, 'media_id':None, 'text':'', 'color':'#8b5cf6',
                'locked':False, 'props':{'shape_kind':'Empty Element','empty_element':True,'workflow_id':None}})
            saved = client.put(f'/api/v1/projects/{project_id}/timeline', headers=headers, json=timeline)
            assert saved.status_code == 200, saved.text

            created = client.post(f'/api/v1/n8n/projects/{project_id}/workflows', headers=headers, json={
                'element_client_id': element_id, 'title':'Movie Recap'})
            assert created.status_code == 201, created.text
            first = created.json()
            assert first['n8n_workflow_id'] == 'wf-1'
            loaded = client.get(f'/api/v1/n8n/projects/{project_id}/workflows/{first["id"]}')
            assert loaded.status_code == 200 and loaded.json()['editor_path'].endswith('/workflow/wf-1')

            copied = client.post(f'/api/v1/n8n/projects/{project_id}/workflows/{first["id"]}/duplicate', headers=headers, json={
                'element_client_id': element_id, 'title':'Movie Recap (copy)'})
            assert copied.status_code == 201, copied.text
            clone = copied.json()
            assert clone['n8n_workflow_id'] == 'wf-2' and 'wf-1' in workflows
            unlinked = client.delete(f'/api/v1/n8n/projects/{project_id}/workflows/{clone["id"]}?delete_underlying=false', headers=headers)
            assert unlinked.status_code == 204 and 'wf-2' in workflows

            unauthorized = client.get(f'/api/v1/n8n/tools/projects/{project_id}')
            assert unauthorized.status_code == 401
            authorized = client.get(f'/api/v1/n8n/tools/projects/{project_id}', headers={'Authorization':'Bearer service-test-token'})
            assert authorized.status_code == 200 and authorized.json()['name'] == 'Film'
        print('n8n lifecycle and service authentication pass')
    ''')
    env = {
        **os.environ,
        'DATABASE_URL': f"sqlite:///{tmp_path / 'n8n.db'}",
        'SECRET_KEY': 'isolated-test-secret',
        'STORAGE_DIR': str(tmp_path / 'storage'),
        'N8N_API_KEY': 'test-key',
        'CLIPTORA_N8N_SERVICE_TOKEN': 'service-test-token',
        'CLIPTORA_N8N_SSO_SECRET': 'test-sso-secret-that-is-longer-than-32-characters',
    }
    result = subprocess.run([sys.executable, '-c', code], cwd=root, env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + '\n' + result.stderr
