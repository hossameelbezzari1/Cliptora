import os
os.environ["DATABASE_URL"]="sqlite+pysqlite:///./test_cliptora.db"
os.environ["COOKIE_SECURE"]="false"
from fastapi.testclient import TestClient
from app.database import Base, engine
from app.main import app

Base.metadata.drop_all(engine); Base.metadata.create_all(engine)
def client(): return TestClient(app)
def csrf(c): return c.get("/api/v1/auth/csrf").json()["csrf_token"]
def register(c,email,name="Editor"):
    token=csrf(c); return c.post("/api/v1/auth/register",headers={"X-CSRF-Token":token},json={"display_name":name,"email":email,"password":"VerySecure123!","password_confirmation":"VerySecure123!"})
def test_auth_project_timeline_and_ownership():
    owner=client(); stranger=client(); assert register(owner,"owner@example.com").status_code==200
    token=owner.cookies["cliptora_csrf"]
    created=owner.post("/api/v1/projects",headers={"X-CSRF-Token":token},json={"name":"Film","width":1920,"height":1080,"aspect_ratio":"16:9","fps":30}); assert created.status_code==201; project=created.json()
    saved=owner.put(f"/api/v1/projects/{project['id']}/timeline",headers={"X-CSRF-Token":token},json={"revision":project["revision"],"tracks":[{"client_id":"v1","name":"V1","type":"video","position":0,"hidden":False,"muted":False,"locked":False}]}); assert saved.status_code==200; assert saved.json()["tracks"][0]["name"]=="V1"
    assert register(stranger,"stranger@example.com").status_code==200
    assert stranger.get(f"/api/v1/projects/{project['id']}").status_code==404
    assert stranger.get(f"/api/v1/projects/{project['id']}/timeline").status_code==404
def test_csrf_and_logout():
    c=client(); assert register(c,"csrf@example.com").status_code==200
    assert c.post("/api/v1/projects",json={"name":"Blocked"}).status_code==403
    token=c.cookies["cliptora_csrf"]; assert c.post("/api/v1/auth/logout",headers={"X-CSRF-Token":token}).status_code==204; assert c.get("/api/v1/auth/me").status_code==401
def test_password_reset_is_single_use_and_revokes_session():
    c=client(); assert register(c,"reset@example.com").status_code==200; token=c.cookies["cliptora_csrf"]
    forgot=c.post("/api/v1/auth/forgot-password",headers={"X-CSRF-Token":token},json={"email":"reset@example.com"}); raw=forgot.json()["dev_reset_url"].split("token=")[1]
    reset=c.post("/api/v1/auth/reset-password",headers={"X-CSRF-Token":token},json={"token":raw,"password":"AnotherSecure123!","password_confirmation":"AnotherSecure123!"}); assert reset.status_code==200
    assert c.get("/api/v1/auth/me").status_code==401
    assert c.post("/api/v1/auth/reset-password",headers={"X-CSRF-Token":token},json={"token":raw,"password":"AnotherSecure123!","password_confirmation":"AnotherSecure123!"}).status_code==400
