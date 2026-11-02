"""Per-run, per-node credential resolution. Nothing is injected into os.environ."""
from __future__ import annotations
from contextlib import contextmanager
from contextvars import ContextVar
from app.core.Database import SessionLocal
from app.services.CredentialService import CredentialService

_owner: ContextVar[int|None] = ContextVar('cliptora_workflow_owner',default=None)
_active: ContextVar[tuple[str,dict]|None] = ContextVar('cliptora_workflow_credentials',default=None)

@contextmanager
def execution_owner(user_id:int):
    token=_owner.set(user_id)
    try:yield
    finally:_owner.reset(token)

@contextmanager
def bind_for_node(node:dict):
    settings=node.get('settings') or {}
    ident=settings.get('credential_id')
    node_type=str(node.get('type') or '')
    if node_type=='ai.gemini':provider='gemini'
    elif node_type=='ai.ollama':provider='ollama'
    elif node_type in ('ai.openai','ai.agent'):provider='openai'
    elif node_type in ('ai.highlights','ai.summary') and (settings.get('mode')=='gemini'):
        provider='gemini'
    elif node_type.startswith('ai.'):
        provider=str(settings.get('provider') or 'openai').lower()
    else:
        provider=None
    if ident is None:
        token=_active.set(None)
        try:yield
        finally:_active.reset(token)
        return
    user_id=_owner.get()
    if user_id is None:raise ValueError('Credential execution requires an authenticated workflow owner')
    if type(ident) is not int or ident<1 or provider not in ('gemini','openai','ollama'):
        raise ValueError('Invalid credential reference or node provider')
    with SessionLocal() as db:
        value=CredentialService().resolve(db,user_id,ident,provider)
    token=_active.set((provider,value))
    try:yield
    finally:_active.reset(token)

def credential_field(provider:str,key:str,default=None):
    active=_active.get()
    if active is None or active[0]!=provider:
        return default
    return active[1].get(key,default)

def api_key(provider:str)->str:
    value=credential_field(provider,'api_key')
    if not isinstance(value,str) or not value:
        raise ValueError(f'{provider.title()} credential not configured. Select one in the node settings.')
    return value
