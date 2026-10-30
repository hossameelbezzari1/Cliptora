"""MySQL-backed global user library, independent of any project."""
import json
from datetime import datetime
from typing import Any, Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.services.library_schema import get_library_db
from app.core.security import current_user
from app.models import User, UserLibraryItem

Kind = Literal['component','group','folder','effect','animation','variable']
router = APIRouter(prefix='/library', tags=['Personal library'])

class ItemIn(BaseModel):
    kind: Kind
    name: str = Field(min_length=1, max_length=160)
    parent_id: int | None = None
    payload: dict[str, Any] = Field(default_factory=dict)

class ItemPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    parent_id: int | None = None
    payload: dict[str, Any] | None = None


def present(item: UserLibraryItem):
    try:
        payload = json.loads(item.payload_json or '{}')
        if not isinstance(payload, dict):
            payload = {}
    except (ValueError, TypeError):
        payload = {}
    return dict(id=item.id, kind=item.kind, name=item.name, parent_id=item.parent_id,
                payload=payload, created_at=item.created_at, updated_at=item.updated_at)

def owned(item_id: int, user: User, db: Session):
    item=db.get(UserLibraryItem,item_id)
    if item is None or item.user_id!=user.id: raise HTTPException(404,'Library item not found')
    return item

def check_parent(parent_id: int | None, user: User, db: Session, item_id: int | None = None):
    if parent_id is None: return
    parent=owned(parent_id,user,db)
    if parent.kind not in ('folder','group'): raise HTTPException(422,'Parent must be a folder or group')
    seen={item_id} if item_id else set()
    current=parent
    while current:
        if current.id in seen: raise HTTPException(422,'Circular groups are not allowed')
        seen.add(current.id)
        current=db.get(UserLibraryItem,current.parent_id) if current.parent_id else None

@router.get('')
def listing(kind: Kind | None = None,user: User = Depends(current_user),db: Session = Depends(get_library_db)):
    stmt=select(UserLibraryItem).where(UserLibraryItem.user_id==user.id)
    if kind: stmt=stmt.where(UserLibraryItem.kind==kind)
    return [present(x) for x in db.scalars(stmt.order_by(UserLibraryItem.id.desc())).all()]

@router.post('',status_code=201)
def create(data:ItemIn,user: User = Depends(current_user),db: Session = Depends(get_library_db)):
    check_parent(data.parent_id,user,db)
    item=UserLibraryItem(user_id=user.id,kind=data.kind,name=data.name.strip(),parent_id=data.parent_id,
        payload_json=json.dumps(data.payload,ensure_ascii=False))
    db.add(item);db.commit();db.refresh(item);return present(item)

@router.patch('/{item_id}')
def update(item_id:int,data:ItemPatch,user:User=Depends(current_user),db:Session=Depends(get_library_db)):
    item=owned(item_id,user,db)
    fields=data.model_fields_set
    if 'parent_id' in fields:
        check_parent(data.parent_id,user,db,item_id);item.parent_id=data.parent_id
    if 'name' in fields and data.name is not None:item.name=data.name.strip()
    if 'payload' in fields and data.payload is not None:item.payload_json=json.dumps(data.payload,ensure_ascii=False)
    db.commit();db.refresh(item);return present(item)

@router.delete('/{item_id}',status_code=204)
def delete(item_id:int,user:User=Depends(current_user),db:Session=Depends(get_library_db)):
    item=owned(item_id,user,db)
    for child in db.scalars(select(UserLibraryItem).where(UserLibraryItem.user_id==user.id,UserLibraryItem.parent_id==item.id)).all():
        child.parent_id=item.parent_id
    db.delete(item);db.commit()
