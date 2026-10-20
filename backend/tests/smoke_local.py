import os,sys,tempfile,io
from pathlib import Path
root=str(Path(__file__).resolve().parents[1])
sys.path.insert(0,root)
with tempfile.TemporaryDirectory() as tmp:
 os.environ['DATABASE_URL']='sqlite:///'+tmp+'/test.db'
 os.environ['STORAGE_DIR']=tmp+'/storage'
 os.environ['SECRET_KEY']='test-secret-not-prod'
 from app.core.database import Base,engine
 import app.models
 Base.metadata.create_all(engine)
 from fastapi.testclient import TestClient
 from app.main import app
 with TestClient(app) as client:
  def ok(r, n):
   if r.status_code>=400: print(n,r.status_code,r.text[:1200]);raise RuntimeError(n)
   print(n,r.status_code);return r
  ok(client.get('/api/v1/health'),'health')
  csrf=ok(client.get('/api/v1/auth/csrf'),'csrf').json()['csrf_token']
  H={'X-CSRF-Token':csrf}
  r=ok(client.post('/api/v1/auth/register',headers=H,json={'display_name':'Demo','email':'demo@example.com','password':'secure-12345','password_confirmation':'secure-12345'}),'register')
  ok(client.get('/api/v1/auth/me'),'me')
  r=ok(client.post('/api/v1/projects',headers=H,json={'name':'Hello Project','width':1920,'height':1080,'fps':30}),'project create'); pid=r.json()['id']
  ok(client.get('/api/v1/projects'),'projects list')
  ok(client.get(f'/api/v1/projects/{pid}/timeline'),'timeline empty')
  clip={'client_id':'clip-a','name':'Title','type':'text','start':0,'duration':5,'source_offset':0,'media_id':None,'text':'Hello!','color':'#5bff93'}
  track={'client_id':'track-a','name':'TEXT 1','type':'text','position':0,'hidden':False,'muted':False,'locked':False,'clips':[clip]}
  ok(client.put(f'/api/v1/projects/{pid}/timeline',headers=H,json={'revision':1,'tracks':[track]}),'timeline save')
  ok(client.post(f'/api/v1/projects/{pid}/ai-scripts',headers=H,json={'name':'Test','instructions':'A descriptive instruction'}),'script create')
  ok(client.get(f'/api/v1/projects/{pid}/ai-scripts'),'scripts list')
  r=ok(client.post(f'/api/v1/projects/{pid}/media',headers=H,files={'file':('test.png',io.BytesIO(b'fake-media'),'image/png')}),'media upload')
  mid=r.json()['id']
  ok(client.get(f'/api/v1/media/{mid}/file'),'media private retrieval')
  ok(client.get(f'/api/v1/projects/{pid}/media'),'media list')
  ok(client.post('/api/v1/auth/forgot-password',headers=H,json={'email':'demo@example.com'}),'forgot dev')
  ok(client.post('/api/v1/auth/logout',headers=H),'logout')
  unauthorized=client.get('/api/v1/auth/me');print('me after logout',unauthorized.status_code);assert unauthorized.status_code==401
 engine.dispose()
 print('SMOKE SUCCESS')
