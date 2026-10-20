# CLIPTORA 2 · AI Video Editor

New independent project foundation; no Laravel. Full-stack **React 19 + TypeScript + Tailwind CSS v4 + Vite + Zustand** frontend, **FastAPI + SQLAlchemy + MySQL** backend.

## Windows / XAMPP: install

**Keep your existing `.git` folder.** The ZIP contains a `frontend/`, `backend/`, `scripts/`, `shared/`, `storage/`, `.gitignore` and this README; it contains no `.git` folder. If you are replacing an old CLIPTORA project, remove only the application source you intend to replace. Do not delete `.git`, do not delete the existing MySQL database, and do not merge an old `node_modules` or `.venv` into this version. The new database default is `cliptora_v2`, leaving old `cliptora` DB intact.

1. Extract the contents of this ZIP directly into `C:\xampp\htdocs\CLIPTORA`.
2. Start **MySQL** in XAMPP.
3. In PowerShell at the root, run: `powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1`.
4. Run: `powershell -ExecutionPolicy Bypass -File .\scripts\start-all.ps1`. Or open separate terminals with `scripts\start-backend.ps1` and `scripts\start-frontend.ps1`.
5. Open the **Local** or **Network** URL printed by Vite. The port may change automatically; LAN IP is discovered by Vite at runtime.

The backend runs on `http://127.0.0.1:8000` and is proxied through Vite via `/api/v1`. **Never point the frontend directly at a fixed LAN IP.** The Vite proxy target is configurable in `frontend/.env` (`BACKEND_URL=http://127.0.0.1:8000`), and both local and network sessions share same-origin cookies.

## What works

- Registration, Login, Logout, Profile and password reset in development (without email integration).
- Secure HttpOnly cookie sessions and HMAC-signed double-submit CSRF; private per-user projects/media.
- Project create, rename/settings, list, duplicate (metadata only) and delete.
- Import MP4/WebM/MOV, JPG/PNG/WebP, MP3/WAV/OGG/M4A to private storage, then insert as a clip into a track. MP4/WebM have the best browser playback compatibility; MOV support varies by browser. Client probes source duration when possible, fallback eight seconds is editable.
- Timeline tracks and clips, visibility, lock, mute, clip selection, text overlays, edit timing/duration, delete, undo/redo and autosave with revision conflict handling.
- HTML5 media preview and basic timeline playback. Preview mutes the source video (audio can be placed on an Audio track); effects/export remain planned.
- AI Studio: save script instructions, prepare transcript-only prompt, copy to preferred model, import/validate scene JSON and append non-destructive source-time clips. AI prompts do not perform visual analysis. The app does not call external AI APIs automatically.
- Layout styled using Tailwind v4 utility classes; dark UI follows provided visual reference. `src/components/ui` hosts shared controls; **no `features/` directory**.

## Not yet implemented

Automatic Whisper transcription, Gemini/OpenAI execution, visual object editing, effects/transitions/animations, keyframe automation, drag-and-drop clip repositioning, FFmpeg export, thumbnails for videos, reset email delivery and full production deployment are future phases. Buttons for unavailable tools are marked or disabled; no fake results or demo assets are passed off as real functionality.

## Commands

- `frontend`: `npm run dev`, `npm run typecheck`, `npm run build`.
- `backend`: `python -m app.init_db`, `python -m uvicorn app.main:app --reload`, `pytest` (requires `requirements-dev.txt`).
- API docs: `http://127.0.0.1:8000/docs`.

## MySQL

Edit `backend/.env` if XAMPP root password/port differs. `scripts/install.ps1` copies .env.example **only when .env does not already exist**. `app.init_db` uses `CREATE DATABASE IF NOT EXISTS` and `metadata.create_all`, never drops tables. It does not migrate old schemas. Never point it at an old existing schema with different columns.

## Git

No script calls `git init`, `git reset`, `git clean`, `git add`, `git commit`, performs backup creation, or touches `.git`. Review with `git status --short`, then decide what to commit yourself. `.env`, `.venv`, `node_modules` and uploaded media are ignored.

## Security / deployment

This is a local-development application, **not a production-hardened deployment**. Before production: configure HTTPS, `ENVIRONMENT=production`, a strong `SECRET_KEY`, correct trusted origin, secure proxy and DB credentials; implement password-reset email sender, enforce quotas, content scanning, request throttling, origin controls and production storage/asset serving. Vite dev server should not be used as a public internet server.
