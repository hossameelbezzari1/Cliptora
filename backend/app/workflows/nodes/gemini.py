"""CLIPTORA native GeminiNode — provider operations colocated in one node module.

Provider implementation is native to this class. Keep operation IDs unchanged.
"""
from __future__ import annotations
from app.workflows.Node import Node
import hashlib
import base64
import ipaddress
import json
import math
import os
import re
import socket
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable
from app.workflows.ModelConstants import OPENAI_TEXT_MODELS, OPENAI_IMAGE_MODELS, OPENAI_MODERATION_MODELS, OPENAI_REASONING_EFFORTS, GEMINI_TEXT_MODELS, GEMINI_IMAGE_MODELS
from app.helpers.Transcript import input_path
from app.workflows.InputResolver import resolve_input_path, infer_text_input
from app.workflows.Credentials import api_key, credential_field
import http.client
import mimetypes
import time
from typing import Any
from app.workflows.Credentials import api_key as resolve_api_key, credential_field

class SafeGoogleRedirect(urllib.request.HTTPRedirectHandler):

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urllib.parse.urlsplit(newurl)
        host = (u.hostname or '').lower()
        allowed = host in {'generativelanguage.googleapis.com', 'storage.googleapis.com'} or host.endswith('.googleusercontent.com')
        if u.scheme != 'https' or not allowed or u.username or u.password:
            raise ValueError('Gemini response redirected to an untrusted host')
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected and urllib.parse.urlsplit(req.full_url).hostname != host:
            redirected.remove_header('x-goog-api-key')
        return redirected
API = 'https://generativelanguage.googleapis.com/v1beta'
UPLOAD_API = 'https://generativelanguage.googleapis.com/upload/v1beta'
MAX_RESPONSE = 12 * 1024 * 1024
MAX_MEDIA_BYTES = 256 * 1024 * 1024
MAX_GENERATED_BYTES = 256 * 1024 * 1024
MODEL_RE = re.compile('^(?:models/)?[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$')
RESOURCE_RE = re.compile('^(?:files|fileSearchStores|operations|interactions)/[a-zA-Z0-9_./:-]{1,300}$')
MEDIA_KEYS = ('file_path', 'media_path', 'audio_path', 'image_path', 'video_path', 'path', 'audio', 'image', 'video', 'file')
MIMES = {'.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json', '.html': 'text/html', '.xml': 'application/xml'}
KINDS = {'audio': {'audio/'}, 'video': {'video/'}, 'image': {'image/'}, 'document': {'application/pdf', 'text/', 'application/json', 'application/xml'}, 'file_search': {'application/pdf', 'text/', 'application/json', 'application/xml'}, 'media': {'audio/', 'video/', 'image/', 'application/pdf', 'text/', 'application/json'}}
_OPENER = urllib.request.build_opener(SafeGoogleRedirect())
API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta'
MODEL_PATTERN = re.compile('^(?:models/)?([a-zA-Z0-9][a-zA-Z0-9._-]{0,100})$')
FREE_TIER_CANDIDATES = {'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash-lite'}
_HIGHLIGHTS_SCHEMA: dict[str, Any] = {'type': 'OBJECT', 'properties': {'highlights': {'type': 'ARRAY', 'items': {'type': 'OBJECT', 'properties': {'start_word_id': {'type': 'INTEGER'}, 'end_word_id': {'type': 'INTEGER'}, 'score': {'type': 'NUMBER'}, 'reason': {'type': 'STRING'}}, 'required': ['start_word_id', 'end_word_id', 'score', 'reason']}}}, 'required': ['highlights']}

class GeminiNode(Node):
    family = 'gemini'
    group = 'AI'
    icon = 'brand:gemini'
    operations = {'ai.gemini': {'icon': 'brand:gemini', 'label': 'Google Gemini', 'settings': {'action': 'message_model', 'credential_id': None, 'model': 'gemini-3.8-flash', 'prompt': ''}, 'credentials': ['gemini'], 'actions': [{'id': 'message_model', 'label': 'Message a Model', 'icon': 'lucide:message-square-text'}, {'id': 'analyze_audio', 'label': 'Analyze Audio', 'icon': 'lucide:audio-lines'}, {'id': 'transcribe_recording', 'label': 'Transcribe Recording', 'icon': 'lucide:mic'}, {'id': 'analyze_video', 'label': 'Analyze Video', 'icon': 'lucide:video'}, {'id': 'analyze_image', 'label': 'Analyze Image', 'icon': 'lucide:image'}, {'id': 'analyze_document', 'label': 'Analyze Document', 'icon': 'lucide:file-text'}, {'id': 'upload_media_file', 'label': 'Upload Media', 'icon': 'lucide:file-up'}, {'id': 'generate_image', 'label': 'Generate Image', 'icon': 'lucide:image-plus'}, {'id': 'edit_image', 'label': 'Edit Image', 'icon': 'lucide:images'}, {'id': 'generate_video', 'label': 'Generate Video', 'icon': 'lucide:clapperboard'}, {'id': 'download_video', 'label': 'Download Video', 'icon': 'lucide:download'}, {'id': 'create_file_search_store', 'label': 'Create File Search Store', 'icon': 'lucide:folder-plus'}, {'id': 'list_file_search_stores', 'label': 'List File Search Stores', 'icon': 'lucide:folder-search'}, {'id': 'upload_file_to_search_store', 'label': 'Upload File to Search Store', 'icon': 'lucide:file-up'}, {'id': 'delete_file_search_store', 'label': 'Delete File Search Store', 'icon': 'lucide:folder-x'}]}}

    parameter_fields = {
        'ai.gemini': {
            'model': {'type': 'string', 'widget': 'model', 'title': 'Model'},
        },
    }
    action_fields = {'ai.gemini': {
        'message_model': {
            'prompt': {'type': 'string', 'widget': 'textarea', 'title': 'Prompt'},
            'input_path': {'type': 'string', 'widget': 'upstream', 'accepts': ['text', 'json'], 'title': 'Input data'},
            'output_mode': {'type': 'string', 'title': 'Output Mode', 'options': [{'value': 'text', 'label': 'Text'}, {'value': 'json', 'label': 'JSON'}, {'value': 'highlights', 'label': 'Highlights (word-timed clips)'}], 'default': 'text'},
            'messages': {'type': 'array', 'widget': 'messages', 'default': []},
            'output_content_as_json': {'type': 'boolean', 'default': False},
            'target_duration': {'type': 'integer', 'default': 120, 'minimum': 10, 'maximum': 7200, 'visible_if': {'output_mode': 'highlights'}},
            'max_highlights': {'type': 'integer', 'default': 12, 'minimum': 1, 'maximum': 100, 'visible_if': {'output_mode': 'highlights'}},
            'min_clip_seconds': {'type': 'number', 'default': 3, 'visible_if': {'output_mode': 'highlights'}},
            'max_clip_seconds': {'type': 'number', 'default': 35, 'visible_if': {'output_mode': 'highlights'}},
            'chunk_chars': {'type': 'integer', 'default': 14000, 'visible_if': {'output_mode': 'highlights'}},
            'system_prompt': {'type': 'string', 'widget': 'textarea', 'group': 'Advanced', 'title': 'System instruction'},
            'max_output_tokens': {'type': 'integer', 'default': 2048, 'minimum': 128, 'maximum': 32768, 'group': 'Advanced'},
            'temperature': {'type': 'number', 'default': 0.2, 'minimum': 0, 'maximum': 2, 'group': 'Advanced'},
            'timeout_seconds': {'type': 'integer', 'default': 120, 'minimum': 15, 'maximum': 300, 'group': 'Advanced'},
        },
        'analyze_audio': {}, 'transcribe_recording': {}, 'analyze_document': {}, 'analyze_image': {}, 'analyze_video': {},
        'upload_media_file': {}, 'upload_file_to_search_store': {}, 'edit_image': {},
        'generate_image': {
            'prompt': {'type': 'string', 'widget': 'textarea'},
            'image_aspect_ratio': {'type': 'string', 'default': '1:1', 'options': [{'value': v, 'label': v} for v in ('1:1','3:2','2:3','4:3','3:4','16:9','9:16')]},
        },
        'create_file_search_store': {'display_name': {'type': 'string'}},
        'delete_file_search_store': {'store_name': {'type': 'string'}},
        'list_file_search_stores': {},
        'generate_video': {
            'video_model': {'type': 'string', 'default': 'gemini-omni-1.1-flash'},
            'prompt': {'type': 'string', 'widget': 'textarea'},
            'video_aspect_ratio': {'type': 'string', 'default': '16:9', 'options': [{'value':'16:9','label':'16:9'}, {'value':'9:16','label':'9:16'}]},
            'previous_interaction_id': {'type': 'string'},
        },
        'download_video': {
            'interaction_id': {'type': 'string'},
            'generated_video_uri': {'type': 'string'},
        },
    }}
    for _action in operations['ai.gemini']['actions']:
        _id = _action['id']
        _action['resource'] = ('File Search' if 'file_search' in _id or 'search_store' in _id else
            'Audio' if 'audio' in _id or 'recording' in _id else
            'Video' if 'video' in _id else 'Image' if 'image' in _id else
            'Document' if 'document' in _id else 'Media File' if 'media_file' in _id else 'Text')
    _media_fields = {
        'media_input_path': {'type':'string','widget':'upstream','accepts':['media'], 'title':'Media Input'},
        'file_path': {'type':'string', 'group':'Advanced'},
        'file_uri': {'type':'string', 'group':'Advanced'},
        'mime_type': {'type':'string','group':'Advanced'},
        'file_display_name': {'type':'string','group':'Advanced'},
        'timeout_seconds': {'type':'integer','default':120,'group':'Advanced'},
        'poll_seconds': {'type':'integer','default':180,'group':'Advanced'},
    }
    for _id in ('analyze_audio','transcribe_recording','analyze_document','analyze_image','analyze_video','upload_media_file','upload_file_to_search_store','edit_image'):
        action_fields['ai.gemini'][_id].update(_media_fields)
        if _id.startswith(('analyze_', 'transcribe_', 'edit_')):
            action_fields['ai.gemini'][_id]['prompt'] = {'type':'string','widget':'textarea'}
    for _id in ('upload_file_to_search_store','generate_video','edit_image'):
        action_fields['ai.gemini'][_id]['allow_paid_action'] = {'type':'boolean','default':False}
    action_fields['ai.gemini']['upload_file_to_search_store']['store_name'] = {'type':'string'}
    action_fields['ai.gemini']['edit_image'].update({
        'image_model': {'type':'string','default':'gemini-3.1-flash-image-preview'},
        'image_aspect_ratio': {'type':'string','default':'1:1'},
    })

    def execute_operation(self, operation, node, outputs, source, workdir):
        cfg = node.get('settings') or {}
        action = str(cfg.get('action') or cfg.get('operation') or 'message_model')
        if action not in {entry['id'] for entry in self.operations[operation]['actions']}:
            raise ValueError(f'Unsupported Gemini action: {action}')
        if action == 'message_model':
            return self.message_model(node, outputs)
        if action in {'generate_image', 'create_file_search_store', 'list_file_search_stores', 'delete_file_search_store'}:
            return self.gemini_action({**cfg, 'action': action}, outputs)
        return self.run_action(node, outputs, source, workdir)

    @staticmethod
    def gemini_request(method: str, path: str, payload: dict[str, Any] | None=None, timeout: int=120) -> dict[str, Any]:
        """Call a Gemini JSON endpoint using the backend-only API key."""
        key = api_key('gemini')
        if not key:
            raise RuntimeError('Select a Google Gemini credential in the node settings')
        if method not in {'GET', 'POST', 'DELETE'} or not re.fullmatch('[A-Za-z0-9._~:/?=&%-]{1,500}', path):
            raise ValueError('Gemini API request is invalid')
        data = None if payload is None else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode('utf-8')
        request = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/{path.lstrip('/')}", data=data, headers={'x-goog-api-key': key, 'Content-Type': 'application/json', 'User-Agent': 'CLIPTORA-Workflow/1.0'}, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
            result = json.loads(raw) if raw else {}
            if not isinstance(result, dict):
                raise ValueError('Gemini returned a non-object response')
            return result
        except urllib.error.HTTPError as exc:
            try:
                detail = exc.read(4096).decode('utf-8', errors='replace')
            except Exception:
                detail = str(exc)
            raise RuntimeError(f'Gemini request failed ({exc.code}): {detail[:500]}') from exc
        except (urllib.error.URLError, ValueError) as exc:
            raise RuntimeError(f'Gemini request failed: {str(exc)[:300]}') from exc

    @staticmethod
    def gemini_prompt(cfg: dict[str, Any], outputs: dict[str, Any]) -> str:
        prompt = str(cfg.get('prompt', '')).strip()
        input_path_value = str(cfg.get('input_path', '')).strip()
        if input_path_value:
            prompt = f"{prompt}\n\nInput data:\n{json.dumps(input_path(outputs, input_path_value), ensure_ascii=False, separators=(',', ':'))}"
        if not prompt or len(prompt) > 200000:
            raise ValueError('Text input must contain between 1 and 200,000 characters')
        return prompt

    @staticmethod
    def gemini_action(cfg: dict[str, Any], outputs: dict[str, Any]) -> dict[str, Any]:
        action = str(cfg.get('action') or 'message_model')
        if action == 'message_model':
            prompt = GeminiNode.gemini_prompt(cfg, outputs)
            model = str(cfg.get('model') or 'gemini-3.8-flash').strip()
            if model not in GEMINI_TEXT_MODELS:
                model = 'gemini-3.8-flash'
            max_tokens = int(cfg.get('max_output_tokens', 1000))
            if not 1 <= max_tokens <= 65536:
                raise ValueError('Gemini maximum output tokens must be between 1 and 65,536')
            payload: dict[str, Any] = {'contents': [{'role': 'user', 'parts': [{'text': prompt}]}], 'generationConfig': {'maxOutputTokens': max_tokens}}
            system_prompt = str(cfg.get('system_prompt', '')).strip()
            if system_prompt:
                payload['systemInstruction'] = {'parts': [{'text': system_prompt[:100000]}]}
            result = GeminiNode.gemini_request('POST', f'models/{model}:generateContent', payload)
            if not bool(cfg.get('simplify_output', True)):
                return result
            candidates = result.get('candidates') or []
            parts = candidates[0].get('content', {}).get('parts', []) if candidates and isinstance(candidates[0], dict) else []
            text = ''.join((str(part.get('text', '')) for part in parts if isinstance(part, dict)))
            finish_reason = candidates[0].get('finishReason') if candidates and isinstance(candidates[0], dict) else None
            return {'text': text, 'model': model, 'usage': result.get('usageMetadata', {}), 'finish_reason': finish_reason}
        if action == 'generate_image':
            prompt = GeminiNode.gemini_prompt(cfg, outputs)
            model = str(cfg.get('model') or 'gemini-3.1-flash-image').strip()
            if model not in GEMINI_IMAGE_MODELS:
                model = 'gemini-3.1-flash-image'
            aspect_ratio = str(cfg.get('image_aspect_ratio') or '1:1')
            if aspect_ratio not in {'1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'}:
                raise ValueError('Unsupported Gemini image aspect ratio')
            result = GeminiNode.gemini_request('POST', f'models/{model}:generateContent', {'contents': [{'role': 'user', 'parts': [{'text': prompt}]}], 'generationConfig': {'responseModalities': ['TEXT', 'IMAGE'], 'imageConfig': {'aspectRatio': aspect_ratio}}}, timeout=180)
            if not bool(cfg.get('simplify_output', True)):
                return result
            candidates = result.get('candidates') or []
            parts = candidates[0].get('content', {}).get('parts', []) if candidates and isinstance(candidates[0], dict) else []
            images = []
            text_parts = []
            for part in parts:
                if not isinstance(part, dict):
                    continue
                if part.get('text'):
                    text_parts.append(str(part['text']))
                inline = part.get('inlineData') or part.get('inline_data')
                if isinstance(inline, dict) and inline.get('data'):
                    images.append({'mime_type': inline.get('mimeType') or inline.get('mime_type') or 'image/png', 'b64_json': inline['data']})
            return {'images': images, 'text': ''.join(text_parts), 'model': model, 'usage': result.get('usageMetadata', {})}
        if action == 'create_file_search_store':
            display_name = str(cfg.get('display_name', '')).strip()
            if not 1 <= len(display_name) <= 128:
                raise ValueError('File Search store display name must contain between 1 and 128 characters')
            return GeminiNode.gemini_request('POST', 'fileSearchStores', {'displayName': display_name, 'embeddingModel': 'models/gemini-embedding-2'})
        if action == 'list_file_search_stores':
            return GeminiNode.gemini_request('GET', 'fileSearchStores?pageSize=100')
        if action == 'delete_file_search_store':
            store_name = str(cfg.get('store_name', '')).strip()
            if not re.fullmatch('fileSearchStores/[A-Za-z0-9_-]{1,128}', store_name):
                raise ValueError('File Search store name must look like fileSearchStores/store-id')
            return GeminiNode.gemini_request('DELETE', f'{store_name}?force=true')
        raise ValueError(f"Gemini action '{action}' is not supported by this CLIPTORA backend")

    @staticmethod
    def _progress(node: dict, stage: str, message: str, percent: int | None=None) -> None:
        cb = node.get('_progress_callback')
        if callable(cb):
            event: dict[str, Any] = {'stage': stage, 'message': message[:200]}
            if percent is not None:
                event['progress'] = max(0, min(99, percent))
            cb(event)

    @staticmethod
    def _key() -> str:
        value = api_key('gemini')
        if not value:
            raise ValueError('Select a Google Gemini credential in the node settings')
        return value

    @staticmethod
    def _paid_guard(cfg: dict, operation: str) -> None:
        if not bool(cfg.get('allow_paid_action')) or credential_field('gemini', 'allow_paid_actions') is not True:
            raise ValueError(f'{operation} can incur Google charges. Enable paid actions for this credential and check Allow paid operation in node settings.')

    @staticmethod
    def _timeout(cfg: dict) -> int:
        try:
            value = int(cfg.get('timeout_seconds') or 120)
        except (TypeError, ValueError) as ex:
            raise ValueError('Request timeout must be an integer') from ex
        return max(15, min(value, 300))

    @staticmethod
    def _model(cfg: dict, *, video: bool=False) -> str:
        name = str((cfg.get('video_model') if video else cfg.get('model_by_id') or cfg.get('model')) or ('gemini-omni-1.1-flash' if video else 'gemini-3.8-flash')).strip()
        if not MODEL_RE.fullmatch(name):
            raise ValueError('Invalid Gemini model ID')
        name = name.removeprefix('models/')
        allowed = {x.strip().removeprefix('models/') for x in ''.split(',') if x.strip()}
        if allowed and name not in allowed:
            raise ValueError(f'Model {name!r} is not in GEMINI_ALLOWED_MODELS')
        return name

    @staticmethod
    def _error(exc: urllib.error.HTTPError, api_key: str) -> RuntimeError:
        try:
            response = json.loads(exc.read(4096))
            msg = str(response.get('error', {}).get('message', ''))[:400]
        except Exception:
            msg = ''
        msg = msg.replace(api_key, '[REDACTED]')
        return RuntimeError(f'Gemini API returned HTTP {exc.code}: {msg}')

    @staticmethod
    def _json_call(url: str, cfg: dict, *, method: str='GET', data: dict | None=None) -> dict:
        if not url.startswith(API + '/') and (not url.startswith(UPLOAD_API + '/')):
            raise ValueError('Refusing non-Google Gemini API URL')
        key = GeminiNode._key()
        headers = {'x-goog-api-key': key}
        body: bytes | None = None
        if data is not None:
            headers['Content-Type'] = 'application/json'
            body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(url, headers=headers, data=body, method=method)
        try:
            with _OPENER.open(req, timeout=GeminiNode._timeout(cfg)) as res:
                raw = res.read(MAX_RESPONSE + 1)
        except urllib.error.HTTPError as ex:
            raise GeminiNode._error(ex, key) from None
        except (TimeoutError, urllib.error.URLError, OSError) as ex:
            raise RuntimeError(f'Cannot connect to Gemini: {type(ex).__name__}') from ex
        if len(raw) > MAX_RESPONSE:
            raise ValueError('Gemini JSON response exceeds the safe size limit')
        if not raw:
            return {}
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise ValueError('Gemini response is not a JSON object')
        if isinstance(parsed.get('error'), dict):
            raise RuntimeError('Gemini returned an error: ' + str(parsed['error'].get('message', 'unknown'))[:350])
        return parsed

    @staticmethod
    def _resource(name: str, kind: str) -> str:
        name = str(name or '').strip().removeprefix('https://generativelanguage.googleapis.com/v1beta/')
        if not RESOURCE_RE.fullmatch(name) or not name.startswith(kind + '/') or '..' in name:
            raise ValueError(f'Invalid Gemini {kind} resource identifier')
        return name

    @staticmethod
    def _safe_media_uri(uri: str) -> str:
        u = urllib.parse.urlsplit(str(uri or ''))
        if u.scheme != 'https' or u.hostname != 'generativelanguage.googleapis.com' or u.port not in (None, 443):
            raise ValueError('Expected a Gemini Files API URI, not an arbitrary internet URL')
        if not re.fullmatch('/v1beta/files/[a-zA-Z0-9_.-]{1,200}', u.path):
            raise ValueError('Invalid Gemini Files API URI')
        return urllib.parse.urlunsplit(('https', u.netloc, u.path, '', ''))

    @staticmethod
    def _allowed_roots(workdir: Path, source: Path | None) -> list[Path]:
        roots = [workdir.resolve(), workdir.resolve().parent]
        for var in ('STORAGE_DIR', 'CLIPTORA_WORKFLOW_ROOT'):
            if os.environ.get(var):
                roots.append(Path(os.environ[var]).resolve())
        if source is not None:
            roots.append(source.resolve().parent)
        return roots

    @staticmethod
    def _local_file(raw: Any, workdir: Path, source: Path | None, kind: str) -> Path:
        if not isinstance(raw, str) or not raw.strip():
            raise ValueError('Missing input file. Use a local CLIPTORA storage path or connect an upstream media node.')
        path = Path(raw.strip())
        candidates = [path] if path.is_absolute() else [workdir / path, workdir.parent / path]
        resolved = next((p.resolve() for p in candidates if p.is_file()), None)
        if resolved is None or not resolved.is_file():
            raise ValueError('Media file not found in CLIPTORA backend storage')
        if not any((resolved.is_relative_to(root) for root in GeminiNode._allowed_roots(workdir, source))):
            raise ValueError('Only CLIPTORA storage/workflow files can be uploaded')
        mime = MIMES.get(resolved.suffix.lower()) or mimetypes.guess_type(resolved.name)[0] or 'application/octet-stream'
        if not any((mime.startswith(prefix) for prefix in KINDS[kind])):
            raise ValueError(f'Expected {kind} media; got {mime}. Convert the source file first.')
        if resolved.stat().st_size > MAX_MEDIA_BYTES:
            raise ValueError('Media file is above the safe 256 MB upload limit of this executor')
        if mime == 'application/pdf' and resolved.stat().st_size > 50 * 1024 * 1024:
            raise ValueError('Gemini PDF uploads must be 50 MB or less')
        if not resolved.stat().st_size:
            raise ValueError('Cannot upload an empty file')
        return resolved

    @staticmethod
    def _find_input(cfg: dict, outputs: dict[str, Any], source: Path | None, workdir: Path, kind: str) -> tuple[str, str, str]:
        """Return (file_uri_or_empty, absolute_local_path_or_empty, mime)."""
        uri = str(cfg.get('file_uri') or '').strip()
        path_value: Any = cfg.get('file_path') or ''
        field = str(cfg.get('media_input_path') or '').strip()
        if field:
            value = GeminiNode._extract_input(outputs, field)
            if isinstance(value, dict):
                uri = str(value.get('file_uri') or value.get('uri') or '')
                path_value = value.get('file_path') or value.get('path') or ''
            elif isinstance(value, str):
                uri = value if value.startswith('https://generativelanguage.googleapis.com/') else ''
                path_value = '' if uri else value
        elif not uri and (not path_value):
            found: list[tuple[str, str]] = []
            for output in outputs.values():
                if not isinstance(output, dict):
                    continue
                if isinstance(output.get('file_uri'), str) and output['file_uri'].startswith('https://generativelanguage.googleapis.com/'):
                    found.append(('uri', output['file_uri']))
                    continue
                for key in MEDIA_KEYS:
                    if isinstance(output.get(key), str) and Path(output[key]).suffix.lower() in MIMES:
                        found.append(('path', output[key]))
                        break
            if len(found) == 1:
                k, v = found[0]
                if k == 'uri':
                    uri = v
                else:
                    path_value = v
            elif len(found) > 1:
                raise ValueError('More than one upstream media input. Set Media Input Path explicitly.')
        if uri:
            declared_mime = str(cfg.get('mime_type') or '').strip()
            for output in outputs.values():
                if isinstance(output, dict) and output.get('file_uri') == uri:
                    declared_mime = str(output.get('mime_type') or declared_mime)
            if not declared_mime:
                raise ValueError('Specify MIME type (for example audio/mpeg) when using an existing Gemini Files URI')
            if not any((declared_mime.startswith(prefix) for prefix in KINDS[kind])):
                raise ValueError(f'MIME type {declared_mime} is not valid for {kind}')
            return (GeminiNode._safe_media_uri(uri), '', declared_mime)
        if not path_value and source is not None and (kind in ('video', 'audio', 'media')):
            path_value = str(source)
        path = GeminiNode._local_file(path_value, workdir, source, kind)
        mime = MIMES.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        return ('', str(path), mime)

    @staticmethod
    def _upload_file(path: Path, mime: str, cfg: dict, node: dict, *, store: str='') -> dict:
        """Google resumable API: start, then binary upload/finalize over HTTPS.

    Binary is streamed in 1MB chunks to avoid holding video in memory.
    """
        size = path.stat().st_size
        suffix = f'/{store}:uploadToFileSearchStore' if store else '/files'
        url = UPLOAD_API + suffix
        metadata = {'displayName': str(cfg.get('file_display_name') or path.name)[:128]} if store else {'file': {'display_name': str(cfg.get('file_display_name') or path.name)[:128]}}
        headers = {'x-goog-api-key': GeminiNode._key(), 'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': str(size), 'X-Goog-Upload-Header-Content-Type': mime}
        req = urllib.request.Request(url, headers=headers, data=json.dumps(metadata).encode(), method='POST')
        try:
            with _OPENER.open(req, timeout=GeminiNode._timeout(cfg)) as response:
                upload_url = response.headers.get('x-goog-upload-url', '')
                response.read(4096)
        except urllib.error.HTTPError as ex:
            raise GeminiNode._error(ex, GeminiNode._key()) from None
        upload_parsed = urllib.parse.urlsplit(upload_url)
        if upload_parsed.scheme != 'https' or upload_parsed.hostname != 'generativelanguage.googleapis.com' or upload_parsed.port not in (None, 443):
            raise ValueError('Google returned an unexpected resumable upload URL')
        if not upload_parsed.path.startswith('/upload/') or upload_parsed.username or upload_parsed.password:
            raise ValueError('Invalid Google upload URL')
        connection = http.client.HTTPSConnection(upload_parsed.hostname, timeout=GeminiNode._timeout(cfg))
        try:
            target = upload_parsed.path + ('?' + upload_parsed.query if upload_parsed.query else '')
            connection.putrequest('POST', target)
            connection.putheader('Content-Type', mime)
            connection.putheader('Content-Length', str(size))
            connection.putheader('X-Goog-Upload-Offset', '0')
            connection.putheader('X-Goog-Upload-Command', 'upload, finalize')
            connection.endheaders()
            sent = 0
            with path.open('rb') as handle:
                while (chunk := handle.read(1024 * 1024)):
                    connection.send(chunk)
                    sent += len(chunk)
                    if size >= 2 * 1024 * 1024:
                        GeminiNode._progress(node, 'uploading', f'Uploading {path.name}: {sent * 100 // size}%', min(75, int(sent / size * 75)))
            res = connection.getresponse()
            raw = res.read(MAX_RESPONSE + 1)
            if res.status >= 400:
                try:
                    reason = json.loads(raw).get('error', {}).get('message', '')
                except Exception:
                    reason = ''
                raise RuntimeError(f'Gemini upload failed: HTTP {res.status} {str(reason)[:350]}')
        finally:
            connection.close()
        if len(raw) > MAX_RESPONSE:
            raise ValueError('Gemini upload response too large')
        obj = json.loads(raw or b'{}')
        if not isinstance(obj, dict):
            raise ValueError('Gemini upload returned invalid JSON')
        return obj

    @staticmethod
    def _poll_file(name: str, cfg: dict, node: dict) -> dict:
        name = GeminiNode._resource(name, 'files')
        end = time.monotonic() + max(30, min(int(cfg.get('poll_seconds') or 180), 900))
        while True:
            payload = GeminiNode._json_call(f'{API}/{name}', cfg)
            state = str(payload.get('state') or 'ACTIVE').upper()
            if state == 'ACTIVE':
                return payload
            if state == 'FAILED':
                raise RuntimeError('Gemini File API could not process the uploaded media file')
            if time.monotonic() >= end:
                raise TimeoutError('Gemini file processing timed out; retry with the returned File URI')
            GeminiNode._progress(node, 'processing_file', 'Waiting for Google to process media', 80)
            time.sleep(3)

    @staticmethod
    def _uploaded(cfg: dict, outputs: dict, source: Path | None, workdir: Path, kind: str, node: dict) -> dict:
        uri, path, mime = GeminiNode._find_input(cfg, outputs, source, workdir, kind)
        if uri:
            return {'file_uri': uri, 'mime_type': mime, 'file_name': ''}
        GeminiNode._progress(node, 'uploading', 'Uploading source to Gemini Files API', 5)
        uploaded = GeminiNode._upload_file(Path(path), mime, cfg, node)
        file = uploaded.get('file') if isinstance(uploaded.get('file'), dict) else uploaded
        if not isinstance(file, dict) or not file.get('name'):
            raise ValueError('Gemini Files API returned no file name')
        if str(file.get('state') or 'ACTIVE').upper() == 'PROCESSING':
            file = GeminiNode._poll_file(file['name'], cfg, node)
        if str(file.get('state') or 'ACTIVE').upper() == 'FAILED':
            raise RuntimeError('Gemini media processing failed')
        file_uri = GeminiNode._safe_media_uri(str(file.get('uri') or ''))
        return {'file_uri': file_uri, 'file_name': str(file['name']), 'mime_type': str(file.get('mimeType') or mime), 'state': file.get('state', 'ACTIVE')}

    @staticmethod
    def _parts_text(resp: dict) -> str:
        texts: list[str] = []
        for candidate in resp.get('candidates', []):
            for part in (candidate.get('content', {}) or {}).get('parts', []):
                if isinstance(part.get('text'), str):
                    texts.append(part['text'])
            if texts:
                return '\n'.join(texts)
        raise ValueError('Gemini returned no text. Check safety filters or response status.')

    @staticmethod
    def _analyze(cfg: dict, outputs: dict, source: Path | None, workdir: Path, kind: str, action: str, node: dict) -> dict:
        file = GeminiNode._uploaded(cfg, outputs, source, workdir, kind, node)
        prompt = str(cfg.get('prompt') or {'analyze_audio': 'Describe the important content and speakers in this audio.', 'transcribe_recording': 'Transcribe all spoken words accurately, preserving the original language. Return the transcript text.', 'analyze_document': 'Summarize this document and its important details.', 'analyze_image': 'Describe this image precisely.', 'analyze_video': 'Summarize the visual and spoken events in this video in chronological order.'}[action]).strip()
        if not prompt:
            raise ValueError('Prompt cannot be empty')
        parts = [{'text': prompt}, {'fileData': {'fileUri': file['file_uri'], 'mimeType': file['mime_type']}}]
        body: dict[str, Any] = {'contents': [{'role': 'user', 'parts': parts}]}
        if cfg.get('system_prompt'):
            body['systemInstruction'] = {'parts': [{'text': str(cfg['system_prompt'])[:20000]}]}
        generation: dict[str, Any] = {'temperature': float(cfg.get('temperature') or 0.2), 'maxOutputTokens': min(32768, max(128, int(cfg.get('max_output_tokens') or 2048)))}
        if cfg.get('output_content_as_json'):
            generation['responseMimeType'] = 'application/json'
        body['generationConfig'] = generation
        model = GeminiNode._model(cfg)
        GeminiNode._progress(node, 'analyzing', f'Analyzing {kind} with {model}', 85)
        response = GeminiNode._json_call(f'{API}/models/{model}:generateContent', cfg, method='POST', data=body)
        text = GeminiNode._parts_text(response)
        result: dict[str, Any] = {'text': text, 'transcript': text if action == 'transcribe_recording' else None, 'model': model, 'file_uri': file['file_uri'], 'mime_type': file['mime_type'], 'usage': response.get('usageMetadata', {}), 'method': 'gemini'}
        if action == 'transcribe_recording':
            result['language'] = str(cfg.get('language') or 'auto')
            result['word_timestamps_available'] = False
        if cfg.get('output_content_as_json'):
            try:
                result['json'] = json.loads(text)
            except ValueError:
                raise ValueError('Gemini returned text that is not valid JSON') from None
        result = {k: v for k, v in result.items() if v is not None}
        GeminiNode._progress(node, 'complete', 'Gemini analysis complete', 99)
        return result

    @staticmethod
    def _poll_operation(name: str, cfg: dict, node: dict) -> dict:
        if not re.fullmatch('fileSearchStores/[a-zA-Z0-9_-]{1,100}/(?:upload/)?operations/[a-zA-Z0-9_-]{1,150}', name):
            raise ValueError('Unexpected Gemini File Search operation name')
        deadline = time.monotonic() + max(30, min(int(cfg.get('poll_seconds') or 180), 900))
        while True:
            operation = GeminiNode._json_call(f'{API}/{name}', cfg)
            if operation.get('done'):
                if isinstance(operation.get('error'), dict):
                    raise RuntimeError('Gemini operation failed: ' + str(operation['error'].get('message', 'unknown'))[:350])
                return operation
            if time.monotonic() >= deadline:
                return operation
            GeminiNode._progress(node, 'indexing', 'Google File Search is indexing the document', 85)
            time.sleep(3)

    @staticmethod
    def _file_search_upload(cfg: dict, outputs: dict, source: Path | None, workdir: Path, node: dict) -> dict:
        GeminiNode._paid_guard(cfg, 'File Search indexing')
        store = GeminiNode._resource(str(cfg.get('store_name') or ''), 'fileSearchStores')
        _, path, mime = GeminiNode._find_input(cfg, outputs, source, workdir, 'file_search')
        if not path:
            raise ValueError('File Search requires a local document path; uploaded Gemini URI is not supported by direct indexing')
        GeminiNode._progress(node, 'indexing', 'Uploading document to Gemini File Search', 5)
        op = GeminiNode._upload_file(Path(path), mime, cfg, node, store=store)
        name = str(op.get('name') or '')
        if not name:
            raise RuntimeError('File Search upload did not return an operation name')
        if op.get('done') is not True:
            op = GeminiNode._poll_operation(name, cfg, node)
        return {'operation_name': name, 'done': bool(op.get('done')), 'store_name': store, 'file_display_name': str(cfg.get('file_display_name') or Path(path).name), 'response': op.get('response', {})}

    @staticmethod
    def _safe_output(workdir: Path, node: dict, extension: str) -> Path:
        folder = workdir / 'gemini_artifacts'
        folder.mkdir(parents=True, exist_ok=True)
        ident = re.sub('[^a-zA-Z0-9_-]', '_', str(node.get('id') or 'gemini'))[:70]
        name = f'{ident}_{int(time.time() * 1000)}.{extension}'
        return folder / name

    @staticmethod
    def _save_base64(data: str, workdir: Path, node: dict, extension: str) -> dict:
        if len(data) > MAX_GENERATED_BYTES * 4 // 3 + 8:
            raise ValueError('Generated content exceeds 256 MB safety limit')
        blob = base64.b64decode(data, validate=True)
        if not blob or len(blob) > MAX_GENERATED_BYTES:
            raise ValueError('Generated media is empty or too large')
        target = GeminiNode._safe_output(workdir, node, extension)
        target.write_bytes(blob)
        return {'file_path': str(target), 'bytes': len(blob), 'mime_type': MIMES.get('.' + extension, 'application/octet-stream')}

    @staticmethod
    def _extract_video_from_interaction(interaction: dict, workdir: Path, node: dict, cfg: dict) -> dict:
        for step in interaction.get('steps') or []:
            if not isinstance(step, dict) or step.get('type') != 'model_output':
                continue
            for part in step.get('content') or []:
                if not isinstance(part, dict) or part.get('type') != 'video':
                    continue
                if isinstance(part.get('data'), str) and part['data']:
                    return GeminiNode._save_base64(part['data'], workdir, node, 'mp4')
                if isinstance(part.get('uri'), str):
                    return {'generated_video_uri': part['uri']}
        return {}

    @staticmethod
    def _generate_video(cfg: dict, outputs: dict, source: Path | None, workdir: Path, node: dict) -> dict:
        GeminiNode._paid_guard(cfg, 'Video generation')
        prompt = str(cfg.get('prompt') or '').strip()
        if not prompt:
            raise ValueError('Generate a video requires a text prompt')
        if len(prompt) > 12000:
            raise ValueError('Video prompt too long')
        model = GeminiNode._model(cfg, video=True)
        if not model.startswith('gemini-omni-'):
            raise ValueError('This executor uses Gemini Omni video model. Veo Preview was retired; choose gemini-omni-1.1-flash.')
        ratio = str(cfg.get('video_aspect_ratio') or '16:9')
        if ratio not in ('16:9', '9:16'):
            raise ValueError('Video aspect ratio must be 16:9 or 9:16')
        GeminiNode._progress(node, 'generating_video', 'Requesting Gemini Omni video generation', 10)
        body: dict[str, Any] = {'model': model, 'input': prompt, 'response_format': {'type': 'video', 'aspect_ratio': ratio, 'delivery': 'uri'}}
        if cfg.get('previous_interaction_id'):
            previous = str(cfg['previous_interaction_id']).strip().removeprefix('interactions/')
            if not re.fullmatch('[a-zA-Z0-9_.-]{1,200}', previous):
                raise ValueError('Invalid previous interaction ID')
            body['previous_interaction_id'] = previous
        resp = GeminiNode._json_call(f'{API}/interactions', cfg, method='POST', data=body)
        identifier = str(resp.get('id') or '')
        result: dict[str, Any] = {'model': model, 'interaction_id': identifier, 'status': str(resp.get('status') or 'unknown'), 'method': 'gemini_omni'}
        result.update(GeminiNode._extract_video_from_interaction(resp, workdir, node, cfg))
        GeminiNode._progress(node, 'generating_video', 'Interaction accepted; download with Download a video if not ready', 95)
        return result

    @staticmethod
    def _download_binary_google(uri: str, cfg: dict, target: Path) -> int:
        parsed = urllib.parse.urlsplit(uri)
        if parsed.scheme != 'https' or parsed.hostname != 'generativelanguage.googleapis.com' or (not parsed.path.startswith('/v1beta/files/')) or (':download' not in parsed.path):
            raise ValueError('Download URI must point to Gemini Files API video download endpoint')
        req = urllib.request.Request(uri, headers={'x-goog-api-key': GeminiNode._key()})
        temp = target.with_suffix('.part')
        total = 0
        try:
            with _OPENER.open(req, timeout=GeminiNode._timeout(cfg)) as res, temp.open('wb') as f:
                while (chunk := res.read(1024 * 1024)):
                    total += len(chunk)
                    if total > MAX_GENERATED_BYTES:
                        raise ValueError('Video exceeds 256 MB safe download limit')
                    f.write(chunk)
            if not total:
                raise RuntimeError('Gemini returned an empty generated video')
            temp.replace(target)
        except urllib.error.HTTPError as ex:
            raise GeminiNode._error(ex, GeminiNode._key()) from None
        finally:
            temp.unlink(missing_ok=True)
        return total

    @staticmethod
    def _download_video(cfg: dict, outputs: dict, workdir: Path, node: dict) -> dict:
        identifier = str(cfg.get('interaction_id') or '').strip()
        uri = str(cfg.get('generated_video_uri') or '').strip()
        if not identifier and (not uri):
            matches = [v for v in outputs.values() if isinstance(v, dict) and (v.get('interaction_id') or v.get('generated_video_uri') or v.get('file_path'))]
            if len(matches) != 1:
                raise ValueError('Connect one Generate a video node or fill Interaction ID / Generated Video URI')
            previous = matches[0]
            if previous.get('file_path') and str(previous['file_path']).endswith('.mp4'):
                return {'file_path': str(GeminiNode._local_file(previous['file_path'], workdir, None, 'video')), 'method': 'reuse_generated_video'}
            identifier = str(previous.get('interaction_id') or '')
            uri = str(previous.get('generated_video_uri') or '')
        if identifier:
            id_value = identifier.removeprefix('interactions/')
            if not re.fullmatch('[a-zA-Z0-9_.-]{1,200}', id_value):
                raise ValueError('Invalid Gemini interaction identifier')
            deadline = time.monotonic() + max(30, min(int(cfg.get('poll_seconds') or 180), 900))
            while True:
                GeminiNode._progress(node, 'waiting_video', 'Fetching Gemini video interaction', 30)
                resp = GeminiNode._json_call(f'{API}/interactions/{id_value}', cfg)
                status = str(resp.get('status') or '').lower()
                if status in {'failed', 'error', 'cancelled'}:
                    raise RuntimeError(f'Gemini video interaction {id_value} ended in state {status}')
                if status not in {'pending', 'running', 'in_progress', 'processing', 'queued'}:
                    media = GeminiNode._extract_video_from_interaction(resp, workdir, node, cfg)
                    if media.get('file_path'):
                        return {'status': 'completed', 'ready': True, 'interaction_id': id_value, **media}
                    uri = str(media.get('generated_video_uri') or uri)
                    if uri:
                        break
                if time.monotonic() >= deadline:
                    raise TimeoutError(f'Gemini video not ready after polling; retry Download a video with interaction ID {id_value}')
                time.sleep(5)
        if not uri:
            raise ValueError('No generated video found in Gemini interaction output')
        GeminiNode._progress(node, 'downloading', 'Downloading generated video from Google', 75)
        target = GeminiNode._safe_output(workdir, node, 'mp4')
        count = GeminiNode._download_binary_google(uri, cfg, target)
        return {'ready': True, 'status': 'completed', 'file_path': str(target), 'video_path': str(target), 'bytes': count, 'mime_type': 'video/mp4'}

    @staticmethod
    def run_action(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        cfg = node.get('settings') or {}
        if not isinstance(cfg, dict):
            raise ValueError('Gemini settings must be a JSON object')
        action = str(cfg.get('action') or cfg.get('operation') or 'message_model')
        GeminiNode._key()
        if action == 'upload_media_file':
            result = GeminiNode._uploaded(cfg, outputs, source, workdir, 'media', node)
            GeminiNode._progress(node, 'complete', 'Gemini media uploaded', 99)
            return result
        if action in {'analyze_audio', 'transcribe_recording', 'analyze_document', 'analyze_image', 'analyze_video'}:
            kind = {'analyze_audio': 'audio', 'transcribe_recording': 'audio', 'analyze_document': 'document', 'analyze_image': 'image', 'analyze_video': 'video'}[action]
            return GeminiNode._analyze(cfg, outputs, source, workdir, kind, action, node)
        if action == 'edit_image':
            GeminiNode._paid_guard(cfg, 'Image editing')
            file = GeminiNode._uploaded(cfg, outputs, source, workdir, 'image', node)
            prompt = str(cfg.get('prompt') or '').strip()
            if not prompt:
                raise ValueError('Edit an image requires a prompt')
            model = str(cfg.get('image_model') or 'gemini-3.1-flash-image-preview').strip()
            if not MODEL_RE.fullmatch(model):
                raise ValueError('Invalid Gemini image model')
            ratio = str(cfg.get('image_aspect_ratio') or '1:1')
            body = {'contents': [{'role': 'user', 'parts': [{'text': prompt}, {'fileData': {'fileUri': file['file_uri'], 'mimeType': file['mime_type']}}]}], 'generationConfig': {'responseModalities': ['TEXT', 'IMAGE'], 'imageConfig': {'aspectRatio': ratio}}}
            GeminiNode._progress(node, 'editing_image', 'Requesting image edit from Gemini', 85)
            resp = GeminiNode._json_call(f"{API}/models/{model.removeprefix('models/')}:generateContent", cfg, method='POST', data=body)
            for candidate in resp.get('candidates') or []:
                for part in (candidate.get('content') or {}).get('parts') or []:
                    if isinstance(part, dict) and isinstance(part.get('inlineData'), dict) and part['inlineData'].get('data'):
                        ext = 'png' if part['inlineData'].get('mimeType', 'image/png') == 'image/png' else 'jpg'
                        result = GeminiNode._save_base64(part['inlineData']['data'], workdir, node, ext)
                        result.update({'model': model, 'method': 'gemini_image_edit'})
                        return result
            raise ValueError('Gemini did not return an edited image; check billing/model permissions')
        if action == 'upload_file_to_search_store':
            return GeminiNode._file_search_upload(cfg, outputs, source, workdir, node)
        if action == 'generate_video':
            return GeminiNode._generate_video(cfg, outputs, source, workdir, node)
        if action == 'download_video':
            return GeminiNode._download_video(cfg, outputs, workdir, node)
        raise ValueError(f'Gemini operation {action!r} is not implemented in gemini_actions')

    @staticmethod
    def _notify(node: dict[str, Any], *, stage: str, message: str, progress: float | None=None, processed: int | None=None, total: int | None=None) -> None:
        callback = node.get('_progress_callback')
        if not callable(callback):
            return
        event: dict[str, Any] = {'stage': stage, 'message': message}
        if progress is not None:
            event['progress'] = max(0, min(99, round(progress, 2)))
        if processed is not None and total is not None:
            event.update({'processed': processed, 'total': total, 'unit': 'chunks'})
        callback(event)

    @staticmethod
    def _model_name(cfg: dict[str, Any]) -> str:
        selected = str(cfg.get('model_by_id') or cfg.get('model') or 'gemini-3.8-flash').strip()
        match = MODEL_PATTERN.fullmatch(selected)
        if not match:
            raise ValueError('Invalid Gemini model ID')
        model = match.group(1)
        allowed = ''
        if allowed:
            allowlist = {item.strip().removeprefix('models/') for item in allowed.split(',') if item.strip()}
            if model not in allowlist:
                raise ValueError(f"Model '{model}' is not in GEMINI_ALLOWED_MODELS")
        if '0' not in {'0', 'false', 'no'}:
            if model not in FREE_TIER_CANDIDATES:
                raise ValueError(f"Model '{model}' is not in CLIPTORA's free-tier candidate list. Choose an enabled model in the credential settings.")
        return model

    @staticmethod
    def _int_setting(cfg: dict[str, Any], key: str, default: int, low: int, high: int) -> int:
        try:
            n = int(cfg.get(key, default))
        except (TypeError, ValueError) as exc:
            raise ValueError(f'{key} must be an integer') from exc
        if n < low or n > high:
            raise ValueError(f'{key} must be between {low} and {high}')
        return n

    @staticmethod
    def _float_setting(cfg: dict[str, Any], key: str, default: float, low: float, high: float) -> float:
        try:
            n = float(cfg.get(key, default))
        except (TypeError, ValueError) as exc:
            raise ValueError(f'{key} must be a number') from exc
        if not math.isfinite(n) or not low <= n <= high:
            raise ValueError(f'{key} must be between {low} and {high}')
        return n

    @staticmethod
    def _extract_input(outputs: dict[str, Any], path: str) -> Any:
        """Shared, validated upstream field resolver."""
        return resolve_input_path(outputs, path)

    @staticmethod
    def _upstream_words(outputs: dict[str, Any]) -> list[dict[str, Any]]:
        matches = [item['words'] for item in outputs.values() if isinstance(item, dict) and isinstance(item.get('words'), list)]
        if len(matches) != 1:
            raise ValueError("Gemini Highlights requires exactly one connected Transcribe Every Word output containing 'words'")
        raw_words = matches[0]
        words: list[dict[str, Any]] = []
        previous = -1
        for item in raw_words:
            if not isinstance(item, dict):
                raise ValueError('Invalid transcript word item')
            try:
                idx, start, end = (int(item['id']), float(item['start']), float(item['end']))
            except (KeyError, TypeError, ValueError) as exc:
                raise ValueError('Transcript words require id/start/end') from exc
            if idx <= previous or not math.isfinite(start) or (not math.isfinite(end)) or (start < 0) or (end < start):
                raise ValueError('Transcript words must have increasing IDs and valid timestamps')
            words.append({'id': idx, 'start': start, 'end': end, 'text': str(item.get('text') or '')})
            previous = idx
        if not words:
            raise ValueError('Transcript contains no words')
        return words

    @staticmethod
    def _chunk_words(words: list[dict[str, Any]], max_chars: int) -> list[list[dict[str, Any]]]:
        chunks: list[list[dict[str, Any]]] = []
        current: list[dict[str, Any]] = []
        size = 0
        for word in words:
            line = f"{word['id']}:{word['text']}"
            if current and size + len(line) + 1 > max_chars:
                chunks.append(current)
                current, size = ([], 0)
            current.append(word)
            size += len(line) + 1
        if current:
            chunks.append(current)
        if len(chunks) > 60:
            raise ValueError('Transcript would require more than 60 Gemini requests; increase chunk_chars')
        return chunks

    @staticmethod
    def _sanitize_api_error(status: int, raw: bytes, api_key: str) -> RuntimeError:
        try:
            detail = json.loads(raw[:4096].decode('utf-8', errors='replace'))
            message = str(detail.get('error', {}).get('message', ''))[:450]
        except (ValueError, TypeError, AttributeError):
            message = ''
        message = message.replace(api_key, '[REDACTED]')
        if status == 429:
            return RuntimeError('Gemini API rate limit or free quota exceeded (429). ' + message)
        if status in (401, 403):
            return RuntimeError('Gemini API key rejected, unavailable model, or project permission error. ' + message)
        return RuntimeError(f'Gemini API request failed (HTTP {status}). ' + message)

    @staticmethod
    def _request(model: str, cfg: dict[str, Any], user_prompt: str, system_prompt: str, *, json_schema: dict[str, Any] | None=None) -> dict[str, Any]:
        api_key = resolve_api_key('gemini')
        if not api_key:
            raise ValueError('Select a Google Gemini credential in the node settings')
        contents: list[dict[str, Any]] = []
        messages = cfg.get('messages') or []
        if not isinstance(messages, list) or len(messages) > 30:
            raise ValueError('messages must be an array with up to 30 entries')
        total_message_chars = 0
        for item in messages:
            if not isinstance(item, dict):
                raise ValueError('Each message must be an object')
            role = str(item.get('role') or 'user').lower()
            content = str(item.get('text') or item.get('content') or '').strip()
            if not content:
                continue
            total_message_chars += len(content)
            if role == 'system':
                system_prompt = (system_prompt + '\n' + content).strip()
                continue
            if role not in ('user', 'model', 'assistant'):
                raise ValueError('Message role must be user, model, assistant, or system')
            contents.append({'role': 'model' if role == 'assistant' else role, 'parts': [{'text': content}]})
        if total_message_chars > 900000:
            raise ValueError('Too much text in Gemini messages')
        if user_prompt.strip():
            contents.append({'role': 'user', 'parts': [{'text': user_prompt}]})
        if not contents:
            raise ValueError('Gemini requires a prompt or at least one nonempty user message')
        body: dict[str, Any] = {'contents': contents}
        if system_prompt:
            body['systemInstruction'] = {'parts': [{'text': system_prompt}]}
        generation: dict[str, Any] = {'maxOutputTokens': GeminiNode._int_setting(cfg, 'max_output_tokens', 2048, 128, 32768)}
        if not model.startswith('gemini-3.'):
            generation['temperature'] = GeminiNode._float_setting(cfg, 'temperature', 0.2, 0, 2)
        if json_schema is not None or bool(cfg.get('output_content_as_json')):
            generation['responseMimeType'] = 'application/json'
            if json_schema is not None:
                generation['responseSchema'] = json_schema
        body['generationConfig'] = generation
        request = urllib.request.Request(f'{API_ENDPOINT}/models/{model}:generateContent', data=json.dumps(body, ensure_ascii=False).encode('utf-8'), headers={'Content-Type': 'application/json', 'X-goog-api-key': api_key}, method='POST')
        timeout = GeminiNode._int_setting(cfg, 'timeout_seconds', 120, 15, 300)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = response.read(8000001)
        except urllib.error.HTTPError as exc:
            raise GeminiNode._sanitize_api_error(exc.code, exc.read(4096), api_key) from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise RuntimeError(f'Cannot reach Gemini API: {type(exc).__name__}. Check Docker DNS/internet access.') from exc
        if len(payload) > 8000000:
            raise ValueError('Gemini response too large')
        try:
            data = json.loads(payload)
            candidates = data.get('candidates') or []
            if not candidates:
                raise ValueError(f"Gemini returned no candidates (block reason: {data.get('promptFeedback', {}).get('blockReason', 'unknown')})")
            candidate = candidates[0]
            parts = candidate.get('content', {}).get('parts', [])
            message = ''.join((part['text'] for part in parts if isinstance(part, dict) and isinstance(part.get('text'), str)))
            if not message.strip():
                raise ValueError(f"Gemini returned no text (finish reason: {candidate.get('finishReason', 'unknown')})")
            return {'text': message, 'usage': data.get('usageMetadata') or {}, 'finish_reason': candidate.get('finishReason')}
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            raise ValueError('Gemini returned an invalid or empty response') from exc

    @staticmethod
    def _json_content(value: str) -> Any:
        try:
            return json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError('Gemini response is not valid JSON. Enable JSON response or simplify the prompt.') from exc

    @staticmethod
    def _select_highlights(raw: list[dict[str, Any]], words: list[dict[str, Any]], target_seconds: int, min_seconds: float, max_seconds: float, max_highlights: int) -> list[dict[str, Any]]:
        by_id = {word['id']: i for i, word in enumerate(words)}
        candidates = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            try:
                first, last = (int(item['start_word_id']), int(item['end_word_id']))
                start_idx, end_idx = (by_id[first], by_id[last])
                score = float(item.get('score', 0))
            except (KeyError, ValueError, TypeError):
                continue
            if end_idx < start_idx or not math.isfinite(score):
                continue
            score = max(0.0, min(1.0, score / 100 if score > 1 else score))
            start = words[start_idx]['start']
            end = words[end_idx]['end']
            if end - start > max_seconds:
                valid_ends = [i for i in range(start_idx, end_idx + 1) if 0 < words[i]['end'] - start <= max_seconds]
                if not valid_ends:
                    continue
                end_idx = valid_ends[-1]
                end = words[end_idx]['end']
                last = words[end_idx]['id']
            if not min_seconds <= end - start <= max_seconds:
                continue
            candidates.append({'start_word_id': first, 'end_word_id': last, 'start': round(start, 3), 'end': round(end, 3), 'score': round(score, 3), 'reason': str(item.get('reason') or 'Selected passage')[:240]})
        ranked = sorted(candidates, key=lambda x: (-x['score'], x['start']))
        accepted: list[dict[str, Any]] = []
        total = 0.0
        for item in ranked:
            if len(accepted) >= max_highlights:
                break
            if any((item['start'] < old['end'] and old['start'] < item['end'] for old in accepted)):
                continue
            remaining = target_seconds - total
            if remaining < min_seconds:
                break
            if item['end'] - item['start'] > remaining:
                continue
            accepted.append(item)
            total += item['end'] - item['start']
        return sorted(accepted, key=lambda x: x['start'])

    @staticmethod
    def _highlights(node: dict[str, Any], cfg: dict[str, Any], outputs: dict[str, Any], model: str) -> dict[str, Any]:
        words = GeminiNode._upstream_words(outputs)
        target_seconds = GeminiNode._int_setting(cfg, 'target_duration', 120, 10, 7200)
        max_highlights = GeminiNode._int_setting(cfg, 'max_highlights', 12, 1, 100)
        chunk_chars = GeminiNode._int_setting(cfg, 'chunk_chars', 14000, 2000, 50000)
        min_seconds = GeminiNode._float_setting(cfg, 'min_clip_seconds', 3, 0.1, 300)
        max_seconds = GeminiNode._float_setting(cfg, 'max_clip_seconds', 35, 1, 900)
        if max_seconds < min_seconds:
            raise ValueError('max_clip_seconds must be >= min_clip_seconds')
        chunks = GeminiNode._chunk_words(words, chunk_chars)
        system = str(cfg.get('system_prompt') or 'You are a precise transcript-only video editor.')
        goal = str(cfg.get('prompt') or 'Choose the most informative, impactful moments for a concise chronological recap.')[:8000]
        proposals: list[dict[str, Any]] = []
        input_tokens = output_tokens = 0
        for i, chunk in enumerate(chunks):
            GeminiNode._notify(node, stage='analyzing_transcript', message=f'Analyzing transcript chunk {i + 1}/{len(chunks)}', progress=i / len(chunks) * 95, processed=i, total=len(chunks))
            lines = ' '.join((f"[{word['id']}] {word['text']}" for word in chunk))
            prompt = f'Editing goal: {goal}\nTotal desired final duration: {target_seconds} seconds. Minimum clip {min_seconds} sec; maximum clip {max_seconds} sec. Select up to {min(12, max_highlights)} meaningful continuous spoken excerpts from THIS CHUNK, in the chronological order of the source. Use ONLY actual word IDs present in this text. Do not invent events, word IDs, or scenes. The source is text-only and may not describe visuals. Prefer coherent sentence boundaries and preserve context. Return JSON with highlights array; score from 0 to 100 and a brief reason. \n\nTRANSCRIPT:\n{lines}'
            response = GeminiNode._request(model, cfg, prompt, system, json_schema=_HIGHLIGHTS_SCHEMA)
            parsed = GeminiNode._json_content(response['text'])
            if not isinstance(parsed, dict) or not isinstance(parsed.get('highlights'), list):
                raise ValueError('Gemini Highlights returned JSON without a highlights array')
            low, high = (chunk[0]['id'], chunk[-1]['id'])
            proposals.extend((item for item in parsed['highlights'] if isinstance(item, dict) and str(item.get('start_word_id', '')).isdigit() and str(item.get('end_word_id', '')).isdigit() and (low <= int(item['start_word_id']) <= int(item['end_word_id']) <= high)))
            input_tokens += int(response['usage'].get('promptTokenCount') or 0)
            output_tokens += int(response['usage'].get('candidatesTokenCount') or 0)
        highlights = GeminiNode._select_highlights(proposals, words, target_seconds, min_seconds, max_seconds, max_highlights)
        GeminiNode._notify(node, stage='finalizing', message='Validating exact word timestamps', progress=99, processed=len(chunks), total=len(chunks))
        return {'highlights': highlights, 'method': 'gemini', 'model': model, 'target_duration': target_seconds, 'selected_duration': round(sum((h['end'] - h['start'] for h in highlights)), 3), 'chunks_processed': len(chunks), 'usage': {'input_tokens': input_tokens, 'output_tokens': output_tokens}, 'word_count': len(words)}

    @staticmethod
    def message_model(node: dict[str, Any], outputs: dict[str, Any]) -> dict[str, Any]:
        cfg = node.get('settings') or {}
        if not isinstance(cfg, dict):
            raise ValueError('Gemini node settings must be an object')
        model = GeminiNode._model_name(cfg)
        mode = str(cfg.get('output_mode') or 'text').lower()
        if mode == 'highlights':
            return GeminiNode._highlights(node, cfg, outputs, model)
        if mode not in ('text', 'json'):
            raise ValueError('output_mode must be text, json, or highlights')
        prompt = str(cfg.get('prompt') or '')
        system = str(cfg.get('system_prompt') or '')
        chosen_path = str(cfg.get('input_path') or '').strip()
        # Auto mode uses one unambiguous connected text output.
        # An explicit path always takes precedence.
        if chosen_path:
            upstream_value = resolve_input_path(outputs, chosen_path)
        else:
            inferred = infer_text_input(outputs)
            upstream_value = inferred[1] if inferred else None
        if upstream_value is not None and upstream_value != '':
            payload_text = (upstream_value if isinstance(upstream_value, str)
                            else json.dumps(upstream_value, ensure_ascii=False))
            prompt = f'{prompt}\n\nUPSTREAM DATA:\n{payload_text}'.strip()
        if not prompt.strip() and not cfg.get('messages'):
            raise ValueError('Gemini Message a model needs a prompt or a connected text output')
        if len(prompt) > 900000:
            raise ValueError('Gemini prompt exceeds 900K characters; use Highlights mode for automatic chunking')
        GeminiNode._notify(node, stage='requesting', message='Waiting for Gemini API response')
        if mode == 'json':
            cfg = {**cfg, 'output_content_as_json': True}
        response = GeminiNode._request(model, cfg, prompt, system)
        result: dict[str, Any] = {'model': model, 'text': response['text'], 'usage': response['usage'], 'finish_reason': response['finish_reason']}
        if mode == 'json' or bool(cfg.get('output_content_as_json')):
            parsed = GeminiNode._json_content(response['text'])
            result['json'] = parsed
            if isinstance(parsed, dict):
                for key, value in parsed.items():
                    if key not in {'model', 'text', 'usage', 'finish_reason', 'json'}:
                        result[key] = value
        GeminiNode._notify(node, stage='finalizing', message='Gemini response received', progress=99)
        return result
