"""Authenticated Credentials CRUD. Never returns key material."""
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from app.core.Database import get_db
from app.core.Security import current_user
from app.models import User, Credential
from app.services.CredentialService import CredentialService
from app.http.requests.CredentialRequest import CredentialCreate,CredentialUpdate

router=APIRouter(prefix='/credentials',tags=['Credentials'])
service=CredentialService()

@router.get('')
def listing(db:Session=Depends(get_db),user:User=Depends(current_user)):
    return service.list(db,user.id)

@router.post('',status_code=201)
def create(data:CredentialCreate,db:Session=Depends(get_db),user:User=Depends(current_user)):
    return service.create(db,user.id,data.name,data.provider,data.data)

@router.patch('/{credential_id}')
def update(credential_id:int,data:CredentialUpdate,db:Session=Depends(get_db),user:User=Depends(current_user)):
    return service.update(db,user.id,credential_id,data.name,data.data)

@router.delete('/{credential_id}',status_code=204)
def delete(credential_id:int,db:Session=Depends(get_db),user:User=Depends(current_user)):
    service.delete(db,user.id,credential_id)
    return Response(status_code=204)


@router.get('/{credential_id}/models')
def models(credential_id:int,db:Session=Depends(get_db),user:User=Depends(current_user)):
    return service.available_models(db,user.id,credential_id)

@router.post('/{credential_id}/test')
def test_connection(credential_id:int,db:Session=Depends(get_db),user:User=Depends(current_user)):
    models=service.available_models(db,user.id,credential_id)
    return {'connected':True,'provider':models['provider'],'models_available':len(models['models'])}
