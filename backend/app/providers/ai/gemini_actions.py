"""CLIPTORA Gemini media/File Search/Omni node actions.

No third-party Python dependency. Files are read only from CLIPTORA storage/workspace;
only Google API endpoints are contacted. Returns JSON-serializable artifact descriptors,
never inline raw media or credentials. Execution requires a Google Gemini API key.
"""
from __future__ import annotations

import base64
import http.client
import json
import mimetypes
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

API = "https://generativelanguage.googleapis.com/v1beta"
UPLOAD_API = "https://generativelanguage.googleapis.com/upload/v1beta"
MAX_RESPONSE = 12 * 1024 * 1024
MAX_MEDIA_BYTES = 256 * 1024 * 1024
MAX_GENERATED_BYTES = 256 * 1024 * 1024
MODEL_RE = re.compile(r"^(?:models/)?[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$")
RESOURCE_RE = re.compile(r"^(?:files|fileSearchStores|operations|interactions)/[a-zA-Z0-9_./:-]{1,300}$")
MEDIA_KEYS = ('file_path', 'media_path', 'audio_path', 'image_path', 'video_path', 'path', 'audio', 'image', 'video', 'file')
MIMES = {
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
    '.json': 'application/json', '.html': 'text/html', '.xml': 'application/xml',
}
KINDS = {
    'audio': {'audio/'}, 'video': {'video/'}, 'image': {'image/'},
    'document': {'application/pdf', 'text/', 'application/json', 'application/xml'},
    'file_search': {'application/pdf', 'text/', 'application/json', 'application/xml'},
    'media': {'audio/', 'video/', 'image/', 'application/pdf', 'text/', 'application/json'},
}


def _progress(node: dict, stage: str, message: str, percent: int | None = None) -> None:
    cb = node.get('_progress_callback')
    if callable(cb):
        event: dict[str, Any] = {'stage': stage, 'message': message[:200]}
        if percent is not None:
            event['progress'] = max(0, min(99, percent))
        cb(event)


def _key() -> str:
    value = os.environ.get('GEMINI_API_KEY', '').strip()
    if not value:
        raise ValueError('GEMINI_API_KEY is missing inside cliptora-backend')
    return value


def _paid_guard(cfg: dict, operation: str) -> None:
    if not bool(cfg.get('allow_paid_action')) or os.environ.get('GEMINI_ENABLE_PAID_ACTIONS') != '1':
        raise ValueError(f'{operation} can incur Google charges. Enable GEMINI_ENABLE_PAID_ACTIONS=1 in backend and check Allow paid operation in node settings.')


def _timeout(cfg: dict) -> int:
    try:
        value = int(cfg.get('timeout_seconds') or 120)
    except (TypeError, ValueError) as ex:
        raise ValueError('Request timeout must be an integer') from ex
    return max(15, min(value, 300))


def _model(cfg: dict, *, video: bool = False) -> str:
    name = str((cfg.get('video_model') if video else (cfg.get('model_by_id') or cfg.get('model'))) or ('gemini-omni-1.1-flash' if video else 'gemini-2.5-flash')).strip()
    if not MODEL_RE.fullmatch(name):
        raise ValueError('Invalid Gemini model ID')
    name = name.removeprefix('models/')
    allowed = {x.strip().removeprefix('models/') for x in os.environ.get('GEMINI_ALLOWED_MODELS', '').split(',') if x.strip()}
    if allowed and name not in allowed:
        raise ValueError(f'Model {name!r} is not in GEMINI_ALLOWED_MODELS')
    return name


def _error(exc: urllib.error.HTTPError, api_key: str) -> RuntimeError:
    try:
        response = json.loads(exc.read(4096))
        msg = str(response.get('error', {}).get('message', ''))[:400]
    except Exception:
        msg = ''
    msg = msg.replace(api_key, '[REDACTED]')
    return RuntimeError(f'Gemini API returned HTTP {exc.code}: {msg}')


class SafeGoogleRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        u = urllib.parse.urlsplit(newurl)
        host = (u.hostname or '').lower()
        allowed = host in {'generativelanguage.googleapis.com', 'storage.googleapis.com'} or host.endswith('.googleusercontent.com')
        if u.scheme != 'https' or not allowed or u.username or u.password:
            raise ValueError('Gemini response redirected to an untrusted host')
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected and urllib.parse.urlsplit(req.full_url).hostname != host:
            redirected.remove_header('x-goog-api-key')
        return redirected


_OPENER = urllib.request.build_opener(SafeGoogleRedirect())


def _json_call(url: str, cfg: dict, *, method: str = 'GET', data: dict | None = None) -> dict:
    if not url.startswith(API + '/') and not url.startswith(UPLOAD_API + '/'):
        raise ValueError('Refusing non-Google Gemini API URL')
    key = _key()
    headers = {'x-goog-api-key': key}
    body: bytes | None = None
    if data is not None:
        headers['Content-Type'] = 'application/json'
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, headers=headers, data=body, method=method)
    try:
        with _OPENER.open(req, timeout=_timeout(cfg)) as res:
            raw = res.read(MAX_RESPONSE + 1)
    except urllib.error.HTTPError as ex:
        raise _error(ex, key) from None
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


def _resource(name: str, kind: str) -> str:
    name = str(name or '').strip().removeprefix('https://generativelanguage.googleapis.com/v1beta/')
    if not RESOURCE_RE.fullmatch(name) or not name.startswith(kind + '/') or '..' in name:
        raise ValueError(f'Invalid Gemini {kind} resource identifier')
    return name


def _safe_media_uri(uri: str) -> str:
    u = urllib.parse.urlsplit(str(uri or ''))
    if u.scheme != 'https' or u.hostname != 'generativelanguage.googleapis.com' or u.port not in (None, 443):
        raise ValueError('Expected a Gemini Files API URI, not an arbitrary internet URL')
    if not re.fullmatch(r'/v1beta/files/[a-zA-Z0-9_.-]{1,200}', u.path):
        raise ValueError('Invalid Gemini Files API URI')
    return urllib.parse.urlunsplit(('https', u.netloc, u.path, '', ''))


def _allowed_roots(workdir: Path, source: Path | None) -> list[Path]:
    roots = [workdir.resolve(), workdir.resolve().parent]
    for var in ('STORAGE_DIR', 'CLIPTORA_WORKFLOW_ROOT'):
        if os.environ.get(var):
            roots.append(Path(os.environ[var]).resolve())
    if source is not None:
        roots.append(source.resolve().parent)
    return roots


def _local_file(raw: Any, workdir: Path, source: Path | None, kind: str) -> Path:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError('Missing input file. Use a local CLIPTORA storage path or connect an upstream media node.')
    path = Path(raw.strip())
    candidates = [path] if path.is_absolute() else [workdir / path, workdir.parent / path]
    resolved = next((p.resolve() for p in candidates if p.is_file()), None)
    if resolved is None or not resolved.is_file():
        raise ValueError('Media file not found in CLIPTORA backend storage')
    if not any(resolved.is_relative_to(root) for root in _allowed_roots(workdir, source)):
        raise ValueError('Only CLIPTORA storage/workflow files can be uploaded')
    mime = MIMES.get(resolved.suffix.lower()) or mimetypes.guess_type(resolved.name)[0] or 'application/octet-stream'
    if not any(mime.startswith(prefix) for prefix in KINDS[kind]):
        raise ValueError(f'Expected {kind} media; got {mime}. Convert the source file first.')
    if resolved.stat().st_size > MAX_MEDIA_BYTES:
        raise ValueError('Media file is above the safe 256 MB upload limit of this executor')
    if mime == 'application/pdf' and resolved.stat().st_size > 50 * 1024 * 1024:
        raise ValueError('Gemini PDF uploads must be 50 MB or less')
    if not resolved.stat().st_size:
        raise ValueError('Cannot upload an empty file')
    return resolved


def _find_input(cfg: dict, outputs: dict[str, Any], source: Path | None, workdir: Path, kind: str) -> tuple[str, str, str]:
    """Return (file_uri_or_empty, absolute_local_path_or_empty, mime)."""
    from app.providers.ai.gemini_message import _extract_input

    uri = str(cfg.get('file_uri') or '').strip()
    path_value: Any = cfg.get('file_path') or ''
    field = str(cfg.get('media_input_path') or '').strip()
    if field:
        value = _extract_input(outputs, field)
        if isinstance(value, dict):
            uri = str(value.get('file_uri') or value.get('uri') or '')
            path_value = value.get('file_path') or value.get('path') or ''
        elif isinstance(value, str):
            uri = value if value.startswith('https://generativelanguage.googleapis.com/') else ''
            path_value = '' if uri else value
    elif not uri and not path_value:
        # The last direct parent is the preferred source; never guess among multiple media matches.
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
            if k == 'uri': uri = v
            else: path_value = v
        elif len(found) > 1:
            raise ValueError('More than one upstream media input. Set Media Input Path explicitly.')
    if uri:
        declared_mime = str(cfg.get('mime_type') or '').strip()
        for output in outputs.values():
            if isinstance(output, dict) and output.get('file_uri') == uri:
                declared_mime = str(output.get('mime_type') or declared_mime)
        if not declared_mime:
            raise ValueError('Specify MIME type (for example audio/mpeg) when using an existing Gemini Files URI')
        if not any(declared_mime.startswith(prefix) for prefix in KINDS[kind]):
            raise ValueError(f'MIME type {declared_mime} is not valid for {kind}')
        return _safe_media_uri(uri), '', declared_mime
    if not path_value and source is not None and kind in ('video', 'audio', 'media'):
        path_value = str(source)
    path = _local_file(path_value, workdir, source, kind)
    mime = MIMES.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    return '', str(path), mime


def _upload_file(path: Path, mime: str, cfg: dict, node: dict, *, store: str = '') -> dict:
    """Google resumable API: start, then binary upload/finalize over HTTPS.

    Binary is streamed in 1MB chunks to avoid holding video in memory.
    """
    size = path.stat().st_size
    suffix = f'/{store}:uploadToFileSearchStore' if store else '/files'
    url = UPLOAD_API + suffix
    metadata = {'displayName': str(cfg.get('file_display_name') or path.name)[:128]} if store else {'file': {'display_name': str(cfg.get('file_display_name') or path.name)[:128]}}
    headers = {
        'x-goog-api-key': _key(), 'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': str(size),
        'X-Goog-Upload-Header-Content-Type': mime,
    }
    req = urllib.request.Request(url, headers=headers, data=json.dumps(metadata).encode(), method='POST')
    try:
        with _OPENER.open(req, timeout=_timeout(cfg)) as response:
            upload_url = response.headers.get('x-goog-upload-url', '')
            response.read(4096)
    except urllib.error.HTTPError as ex:
        raise _error(ex, _key()) from None
    upload_parsed = urllib.parse.urlsplit(upload_url)
    if upload_parsed.scheme != 'https' or upload_parsed.hostname != 'generativelanguage.googleapis.com' or upload_parsed.port not in (None, 443):
        raise ValueError('Google returned an unexpected resumable upload URL')
    if not upload_parsed.path.startswith('/upload/') or upload_parsed.username or upload_parsed.password:
        raise ValueError('Invalid Google upload URL')
    # Upload token remains in a Google-issued URL, not in returned artifacts/logs.
    connection = http.client.HTTPSConnection(upload_parsed.hostname, timeout=_timeout(cfg))
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
            while chunk := handle.read(1024 * 1024):
                connection.send(chunk)
                sent += len(chunk)
                if size >= 2 * 1024 * 1024:
                    _progress(node, 'uploading', f'Uploading {path.name}: {sent * 100 // size}%', min(75, int(sent / size * 75)))
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


def _poll_file(name: str, cfg: dict, node: dict) -> dict:
    name = _resource(name, 'files')
    end = time.monotonic() + max(30, min(int(cfg.get('poll_seconds') or 180), 900))
    while True:
        payload = _json_call(f'{API}/{name}', cfg)
        state = str(payload.get('state') or 'ACTIVE').upper()
        if state == 'ACTIVE':
            return payload
        if state == 'FAILED':
            raise RuntimeError('Gemini File API could not process the uploaded media file')
        if time.monotonic() >= end:
            raise TimeoutError('Gemini file processing timed out; retry with the returned File URI')
        _progress(node, 'processing_file', 'Waiting for Google to process media', 80)
        time.sleep(3)


def _uploaded(cfg: dict, outputs: dict, source: Path | None, workdir: Path, kind: str, node: dict) -> dict:
    uri, path, mime = _find_input(cfg, outputs, source, workdir, kind)
    if uri:
        return {'file_uri': uri, 'mime_type': mime, 'file_name': ''}
    _progress(node, 'uploading', 'Uploading source to Gemini Files API', 5)
    uploaded = _upload_file(Path(path), mime, cfg, node)
    file = uploaded.get('file') if isinstance(uploaded.get('file'), dict) else uploaded
    if not isinstance(file, dict) or not file.get('name'):
        raise ValueError('Gemini Files API returned no file name')
    if str(file.get('state') or 'ACTIVE').upper() == 'PROCESSING':
        file = _poll_file(file['name'], cfg, node)
    if str(file.get('state') or 'ACTIVE').upper() == 'FAILED':
        raise RuntimeError('Gemini media processing failed')
    file_uri = _safe_media_uri(str(file.get('uri') or ''))
    return {'file_uri': file_uri, 'file_name': str(file['name']), 'mime_type': str(file.get('mimeType') or mime), 'state': file.get('state', 'ACTIVE')}


def _parts_text(resp: dict) -> str:
    texts: list[str] = []
    for candidate in resp.get('candidates', []):
        for part in (candidate.get('content', {}) or {}).get('parts', []):
            if isinstance(part.get('text'), str):
                texts.append(part['text'])
        if texts: return '\n'.join(texts)
    raise ValueError('Gemini returned no text. Check safety filters or response status.')


def _analyze(cfg: dict, outputs: dict, source: Path | None, workdir: Path, kind: str, action: str, node: dict) -> dict:
    file = _uploaded(cfg, outputs, source, workdir, kind, node)
    prompt = str(cfg.get('prompt') or {
        'analyze_audio': 'Describe the important content and speakers in this audio.',
        'transcribe_recording': 'Transcribe all spoken words accurately, preserving the original language. Return the transcript text.',
        'analyze_document': 'Summarize this document and its important details.',
        'analyze_image': 'Describe this image precisely.',
        'analyze_video': 'Summarize the visual and spoken events in this video in chronological order.',
    }[action]).strip()
    if not prompt: raise ValueError('Prompt cannot be empty')
    parts = [{'text': prompt}, {'fileData': {'fileUri': file['file_uri'], 'mimeType': file['mime_type']}}]
    body: dict[str, Any] = {'contents': [{'role': 'user', 'parts': parts}]}
    if cfg.get('system_prompt'):
        body['systemInstruction'] = {'parts': [{'text': str(cfg['system_prompt'])[:20000]}]}
    generation: dict[str, Any] = {'temperature': float(cfg.get('temperature') or 0.2), 'maxOutputTokens': min(32768, max(128, int(cfg.get('max_output_tokens') or 2048)))}
    if cfg.get('output_content_as_json'):
        generation['responseMimeType'] = 'application/json'
    body['generationConfig'] = generation
    model = _model(cfg)
    _progress(node, 'analyzing', f'Analyzing {kind} with {model}', 85)
    response = _json_call(f'{API}/models/{model}:generateContent', cfg, method='POST', data=body)
    text = _parts_text(response)
    result: dict[str, Any] = {'text': text, 'transcript': text if action == 'transcribe_recording' else None, 'model': model,
                              'file_uri': file['file_uri'], 'mime_type': file['mime_type'], 'usage': response.get('usageMetadata', {}), 'method': 'gemini'}
    if action == 'transcribe_recording':
        result['language'] = str(cfg.get('language') or 'auto')
        # Gemini text-only transcription is NOT word-timestamped: do not invent words[] or second timings.
        result['word_timestamps_available'] = False
    if cfg.get('output_content_as_json'):
        try: result['json'] = json.loads(text)
        except ValueError: raise ValueError('Gemini returned text that is not valid JSON') from None
    result = {k: v for k, v in result.items() if v is not None}
    _progress(node, 'complete', 'Gemini analysis complete', 99)
    return result


def _poll_operation(name: str, cfg: dict, node: dict) -> dict:
    # Direct File Search upload operations live under fileSearchStores/{id}/upload/operations/{id}.
    if not re.fullmatch(r'fileSearchStores/[a-zA-Z0-9_-]{1,100}/(?:upload/)?operations/[a-zA-Z0-9_-]{1,150}', name):
        raise ValueError('Unexpected Gemini File Search operation name')
    deadline = time.monotonic() + max(30, min(int(cfg.get('poll_seconds') or 180), 900))
    while True:
        operation = _json_call(f'{API}/{name}', cfg)
        if operation.get('done'):
            if isinstance(operation.get('error'), dict):
                raise RuntimeError('Gemini operation failed: ' + str(operation['error'].get('message', 'unknown'))[:350])
            return operation
        if time.monotonic() >= deadline:
            return operation
        _progress(node, 'indexing', 'Google File Search is indexing the document', 85)
        time.sleep(3)


def _file_search_upload(cfg: dict, outputs: dict, source: Path | None, workdir: Path, node: dict) -> dict:
    _paid_guard(cfg, 'File Search indexing')
    store = _resource(str(cfg.get('store_name') or ''), 'fileSearchStores')
    _, path, mime = _find_input(cfg, outputs, source, workdir, 'file_search')
    if not path:
        raise ValueError('File Search requires a local document path; uploaded Gemini URI is not supported by direct indexing')
    _progress(node, 'indexing', 'Uploading document to Gemini File Search', 5)
    op = _upload_file(Path(path), mime, cfg, node, store=store)
    name = str(op.get('name') or '')
    if not name:
        raise RuntimeError('File Search upload did not return an operation name')
    if op.get('done') is not True:
        op = _poll_operation(name, cfg, node)
    return {'operation_name': name, 'done': bool(op.get('done')), 'store_name': store,
            'file_display_name': str(cfg.get('file_display_name') or Path(path).name), 'response': op.get('response', {})}


def _safe_output(workdir: Path, node: dict, extension: str) -> Path:
    folder = workdir / 'gemini_artifacts'
    folder.mkdir(parents=True, exist_ok=True)
    ident = re.sub(r'[^a-zA-Z0-9_-]', '_', str(node.get('id') or 'gemini'))[:70]
    name = f'{ident}_{int(time.time() * 1000)}.{extension}'
    return folder / name


def _save_base64(data: str, workdir: Path, node: dict, extension: str) -> dict:
    if len(data) > MAX_GENERATED_BYTES * 4 // 3 + 8:
        raise ValueError('Generated content exceeds 256 MB safety limit')
    blob = base64.b64decode(data, validate=True)
    if not blob or len(blob) > MAX_GENERATED_BYTES:
        raise ValueError('Generated media is empty or too large')
    target = _safe_output(workdir, node, extension)
    target.write_bytes(blob)
    return {'file_path': str(target), 'bytes': len(blob), 'mime_type': MIMES.get('.' + extension, 'application/octet-stream')}


def _extract_video_from_interaction(interaction: dict, workdir: Path, node: dict, cfg: dict) -> dict:
    for step in interaction.get('steps') or []:
        if not isinstance(step, dict) or step.get('type') != 'model_output': continue
        for part in step.get('content') or []:
            if not isinstance(part, dict) or part.get('type') != 'video': continue
            if isinstance(part.get('data'), str) and part['data']:
                return _save_base64(part['data'], workdir, node, 'mp4')
            if isinstance(part.get('uri'), str):
                return {'generated_video_uri': part['uri']}
    return {}


def _generate_video(cfg: dict, outputs: dict, source: Path | None, workdir: Path, node: dict) -> dict:
    _paid_guard(cfg, 'Video generation')
    prompt = str(cfg.get('prompt') or '').strip()
    if not prompt: raise ValueError('Generate a video requires a text prompt')
    if len(prompt) > 12000: raise ValueError('Video prompt too long')
    model = _model(cfg, video=True)
    if not model.startswith('gemini-omni-'):
        raise ValueError('This executor uses Gemini Omni video model. Veo Preview was retired; choose gemini-omni-1.1-flash.')
    ratio = str(cfg.get('video_aspect_ratio') or '16:9')
    if ratio not in ('16:9', '9:16'): raise ValueError('Video aspect ratio must be 16:9 or 9:16')
    _progress(node, 'generating_video', 'Requesting Gemini Omni video generation', 10)
    body: dict[str, Any] = {'model': model, 'input': prompt,
                            'response_format': {'type': 'video', 'aspect_ratio': ratio, 'delivery': 'uri'}}
    if cfg.get('previous_interaction_id'):
        previous = str(cfg['previous_interaction_id']).strip().removeprefix('interactions/')
        if not re.fullmatch(r'[a-zA-Z0-9_.-]{1,200}', previous):
            raise ValueError('Invalid previous interaction ID')
        body['previous_interaction_id'] = previous
    resp = _json_call(f'{API}/interactions', cfg, method='POST', data=body)
    identifier = str(resp.get('id') or '')
    result: dict[str, Any] = {'model': model, 'interaction_id': identifier,
                              'status': str(resp.get('status') or 'unknown'), 'method': 'gemini_omni'}
    result.update(_extract_video_from_interaction(resp, workdir, node, cfg))
    _progress(node, 'generating_video', 'Interaction accepted; download with Download a video if not ready', 95)
    return result


def _download_binary_google(uri: str, cfg: dict, target: Path) -> int:
    parsed = urllib.parse.urlsplit(uri)
    if parsed.scheme != 'https' or parsed.hostname != 'generativelanguage.googleapis.com' or not parsed.path.startswith('/v1beta/files/') or ':download' not in parsed.path:
        raise ValueError('Download URI must point to Gemini Files API video download endpoint')
    req = urllib.request.Request(uri, headers={'x-goog-api-key': _key()})
    temp = target.with_suffix('.part')
    total = 0
    try:
        with _OPENER.open(req, timeout=_timeout(cfg)) as res, temp.open('wb') as f:
            while chunk := res.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_GENERATED_BYTES: raise ValueError('Video exceeds 256 MB safe download limit')
                f.write(chunk)
        if not total: raise RuntimeError('Gemini returned an empty generated video')
        temp.replace(target)
    except urllib.error.HTTPError as ex:
        raise _error(ex, _key()) from None
    finally:
        temp.unlink(missing_ok=True)
    return total


def _download_video(cfg: dict, outputs: dict, workdir: Path, node: dict) -> dict:
    identifier = str(cfg.get('interaction_id') or '').strip()
    uri = str(cfg.get('generated_video_uri') or '').strip()
    if not identifier and not uri:
        matches = [v for v in outputs.values() if isinstance(v, dict) and (v.get('interaction_id') or v.get('generated_video_uri') or v.get('file_path'))]
        if len(matches) != 1: raise ValueError('Connect one Generate a video node or fill Interaction ID / Generated Video URI')
        previous = matches[0]
        if previous.get('file_path') and str(previous['file_path']).endswith('.mp4'):
            return {'file_path': str(_local_file(previous['file_path'], workdir, None, 'video')), 'method': 'reuse_generated_video'}
        identifier = str(previous.get('interaction_id') or '')
        uri = str(previous.get('generated_video_uri') or '')
    if identifier:
        id_value = identifier.removeprefix('interactions/')
        if not re.fullmatch(r'[a-zA-Z0-9_.-]{1,200}', id_value):
            raise ValueError('Invalid Gemini interaction identifier')
        deadline = time.monotonic() + max(30, min(int(cfg.get('poll_seconds') or 180), 900))
        while True:
            _progress(node, 'waiting_video', 'Fetching Gemini video interaction', 30)
            resp = _json_call(f'{API}/interactions/{id_value}', cfg)
            status = str(resp.get('status') or '').lower()
            if status in {'failed', 'error', 'cancelled'}:
                raise RuntimeError(f'Gemini video interaction {id_value} ended in state {status}')
            if status not in {'pending', 'running', 'in_progress', 'processing', 'queued'}:
                media = _extract_video_from_interaction(resp, workdir, node, cfg)
                if media.get('file_path'):
                    return {'status': 'completed', 'ready': True, 'interaction_id': id_value, **media}
                uri = str(media.get('generated_video_uri') or uri)
                if uri:
                    break
            if time.monotonic() >= deadline:
                # Fail instead of caching a 'pending' result forever in Workflow Engine.
                raise TimeoutError(f'Gemini video not ready after polling; retry Download a video with interaction ID {id_value}')
            time.sleep(5)
    if not uri: raise ValueError('No generated video found in Gemini interaction output')
    _progress(node, 'downloading', 'Downloading generated video from Google', 75)
    target = _safe_output(workdir, node, 'mp4')
    count = _download_binary_google(uri, cfg, target)
    return {'ready': True, 'status': 'completed', 'file_path': str(target), 'video_path': str(target), 'bytes': count, 'mime_type': 'video/mp4'}


def run_action(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
    cfg = node.get('settings') or {}
    if not isinstance(cfg, dict): raise ValueError('Gemini settings must be a JSON object')
    action = str(cfg.get('action') or cfg.get('operation') or 'message_model')
    _key()
    if action == 'upload_media_file':
        result = _uploaded(cfg, outputs, source, workdir, 'media', node)
        _progress(node, 'complete', 'Gemini media uploaded', 99)
        return result
    if action in {'analyze_audio', 'transcribe_recording', 'analyze_document', 'analyze_image', 'analyze_video'}:
        kind = {'analyze_audio': 'audio', 'transcribe_recording': 'audio', 'analyze_document': 'document', 'analyze_image': 'image', 'analyze_video': 'video'}[action]
        return _analyze(cfg, outputs, source, workdir, kind, action, node)
    if action == 'edit_image':
        _paid_guard(cfg, 'Image editing')
        file = _uploaded(cfg, outputs, source, workdir, 'image', node)
        prompt = str(cfg.get('prompt') or '').strip()
        if not prompt: raise ValueError('Edit an image requires a prompt')
        model = str(cfg.get('image_model') or 'gemini-3.1-flash-image-preview').strip()
        if not MODEL_RE.fullmatch(model): raise ValueError('Invalid Gemini image model')
        ratio = str(cfg.get('image_aspect_ratio') or '1:1')
        body = {'contents': [{'role': 'user', 'parts': [
            {'text': prompt}, {'fileData': {'fileUri': file['file_uri'], 'mimeType': file['mime_type']}}
        ]}], 'generationConfig': {'responseModalities': ['TEXT', 'IMAGE'], 'imageConfig': {'aspectRatio': ratio}}}
        _progress(node, 'editing_image', 'Requesting image edit from Gemini', 85)
        resp = _json_call(f'{API}/models/{model.removeprefix("models/")}:generateContent', cfg, method='POST', data=body)
        for candidate in resp.get('candidates') or []:
            for part in (candidate.get('content') or {}).get('parts') or []:
                if isinstance(part, dict) and isinstance(part.get('inlineData'), dict) and part['inlineData'].get('data'):
                    ext = 'png' if part['inlineData'].get('mimeType', 'image/png') == 'image/png' else 'jpg'
                    result = _save_base64(part['inlineData']['data'], workdir, node, ext)
                    result.update({'model': model, 'method': 'gemini_image_edit'})
                    return result
        raise ValueError('Gemini did not return an edited image; check billing/model permissions')
    if action == 'upload_file_to_search_store':
        return _file_search_upload(cfg, outputs, source, workdir, node)
    if action == 'generate_video':
        return _generate_video(cfg, outputs, source, workdir, node)
    if action == 'download_video':
        return _download_video(cfg, outputs, workdir, node)
    raise ValueError(f'Gemini operation {action!r} is not implemented in gemini_actions')
