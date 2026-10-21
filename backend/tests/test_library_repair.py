"""Regression for V3 installations where only My Library's table is missing."""
import os
import subprocess
import sys
import textwrap


def test_missing_library_table_created_automatically(tmp_path):
    root = os.path.dirname(os.path.dirname(__file__))
    code = textwrap.dedent('''
        from sqlalchemy import inspect, select
        from app.core.database import Base, engine, SessionLocal
        from app.models import UserLibraryItem
        import app.models
        Base.metadata.create_all(engine)
        UserLibraryItem.__table__.drop(engine)
        assert not inspect(engine).has_table('user_library_items')
        from fastapi.testclient import TestClient
        from app.main import app
        with TestClient(app) as client:
            csrf = client.get('/api/v1/auth/csrf').json()['csrf_token']
            headers = {'X-CSRF-Token': csrf}
            res = client.post('/api/v1/auth/register', headers=headers, json={
              'display_name': 'Test', 'email': 'library@example.com',
              'password': 'test-password-1234', 'password_confirmation': 'test-password-1234'})
            assert res.status_code == 201, res.text
            res = client.get('/api/v1/library?kind=variable')
            assert res.status_code == 200, res.text
            assert res.json() == []
            assert inspect(engine).has_table('user_library_items')
            res = client.post('/api/v1/library', headers=headers, json={
              'kind':'variable', 'name':'brand_color', 'payload':{'type':'color','value':'#ff00ff'}})
            assert res.status_code == 201, res.text
            res = client.get('/api/v1/library?kind=variable')
            assert res.status_code == 200 and len(res.json()) == 1, res.text
            assert res.json()[0]['payload']['value'] == '#ff00ff'
            res = client.get('/api/v1/library')
            assert res.status_code == 200 and len(res.json()) == 1
            # Repair must not erase/rewrite existing table rows.
            from app.repair_library import main
            main()
            assert len(client.get('/api/v1/library').json()) == 1
        print('PASS: missing table auto-created, library data preserved')
    ''')
    env = {**os.environ,
           'DATABASE_URL': f"sqlite:///{tmp_path / 'repair.db'}",
           'SECRET_KEY': 'isolated-test-secret',
           'STORAGE_DIR': str(tmp_path / 'storage')}
    result = subprocess.run([sys.executable, '-c', code], cwd=root, env=env,
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + '\n' + result.stderr
