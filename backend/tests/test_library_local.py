import os
import subprocess
import sys
import textwrap


def test_library_endpoints(tmp_path):
    root = os.path.dirname(os.path.dirname(__file__))
    code = textwrap.dedent('''
        from app.core.database import Base, engine
        import app.models
        Base.metadata.create_all(engine)
        from fastapi.testclient import TestClient
        from app.main import app
        with TestClient(app) as client:
            csrf=client.get('/api/v1/auth/csrf').json()['csrf_token']
            H={'X-CSRF-Token':csrf}
            def register(email):
                return client.post('/api/v1/auth/register',headers=H,json={
                    'display_name':'Library Tester','email':email,'password':'test-pass-12345','password_confirmation':'test-pass-12345'})
            assert register('one@example.com').status_code==201
            folder=client.post('/api/v1/library',headers=H,json={'kind':'folder','name':'Branding','payload':{}})
            assert folder.status_code==201,folder.text
            fid=folder.json()['id']
            item=client.post('/api/v1/library',headers=H,json={'kind':'component','name':'Intro','parent_id':fid,'payload':{'shape':'Circle'}})
            assert item.status_code==201,item.text
            cid=item.json()['id']
            assert len(client.get('/api/v1/library').json())==2
            illegal=client.patch(f'/api/v1/library/{fid}',headers=H,json={'parent_id':cid})
            assert illegal.status_code==422
            assert client.patch(f'/api/v1/library/{cid}',headers=H,json={'name':'My Intro'}).json()['name']=='My Intro'
            assert client.post('/api/v1/auth/logout',headers=H).status_code==204
            assert register('two@example.com').status_code==201
            assert client.get('/api/v1/library').json()==[]
            assert client.patch(f'/api/v1/library/{cid}',headers=H,json={'name':'Stolen'}).status_code==404
        print('Library isolated and persistent')
    ''')
    env={**os.environ,'DATABASE_URL':f"sqlite:///{tmp_path / 'library.db'}",'SECRET_KEY':'isolated-test-secret','STORAGE_DIR':str(tmp_path/'storage')}
    result=subprocess.run([sys.executable,'-c',code],cwd=root,env=env,capture_output=True,text=True)
    assert result.returncode==0,result.stdout+'\n'+result.stderr
