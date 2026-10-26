> **V2.4 Editor update:** see [TIMELINE_UI_V2.4.md](TIMELINE_UI_V2.4.md) for new resizable panels, context menus, preview transformations, and schema migration.

# CLIPTORA 2 · AI Video Editor

New independent project foundation; no Laravel. Full-stack **React 19 + TypeScript + Tailwind CSS v4 + Vite + Zustand** frontend, **FastAPI + SQLAlchemy + MySQL** backend.

## Windows / XAMPP: install

**Keep your existing `.git` folder.** The ZIP contains a `frontend/`, `backend/`, `scripts/`, `shared/`, `storage/`, `.gitignore` and this README; it contains no `.git` folder. If you are replacing an old CLIPTORA project, remove only the application source you intend to replace. Do not delete `.git`, do not delete the existing MySQL database, and do not merge an old `node_modules` or `.venv` into this version. The new database default is `cliptora_v2`, leaving old `cliptora` DB intact.

1. Extract the contents of this ZIP directly into `C:\xampp\htdocs\CLIPTORA`.
2. Start **MySQL** in XAMPP.
3. In PowerShell at the root, run: `powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1`.
4. If database initialization needs to be repeated without reinstalling packages, run `powershell -ExecutionPolicy Bypass -File .\scripts\init-database.ps1`. Run: `powershell -ExecutionPolicy Bypass -File .\scripts\start-all.ps1`. Or open separate terminals with `scripts\start-backend.ps1` and `scripts\start-frontend.ps1`.
5. Open the **Local** or **Network** URL printed by Vite. The port may change automatically; LAN IP is discovered by Vite at runtime.

The backend runs on `http://127.0.0.1:8000` and is proxied through Vite via `/api/v1`. **Never point the frontend directly at a fixed LAN IP.** The Vite proxy target is configurable in `frontend/.env` (`BACKEND_URL=http://127.0.0.1:8000`), and both local and network sessions share same-origin cookies.

## What works

- Registration, Login, Logout, Profile and password reset in development (without email integration).
- Secure HttpOnly cookie sessions and HMAC-signed double-submit CSRF; private per-user projects/media.
- Project create, rename/settings, list, duplicate (metadata only) and delete.
- Import MP4/WebM/MOV, JPG/PNG/WebP, MP3/WAV/OGG/M4A to private storage, then drag or insert as a clip into any layer. MP4/WebM have the best browser playback compatibility; MOV support varies by browser. Client probes source duration when possible, fallback eight seconds is editable.
- Generic multi-layer timeline (three default), drag/drop clip movement, auto-create layers, resize/trim, zoom, snapping, rename, visibility, lock, mute, delete, undo/redo and autosave with revision conflict handling.
- HTML5 mixed-layer media preview and basic timeline playback. Each layer can carry sound and visuals; video sound respects layer mute. Effects/export remain planned.
- AI Studio plus Dynamic Workflow Studio: build React Flow DAGs, version/duplicate/import/export definitions, run word-timed transcription, transcript-driven highlights, summaries, captions, non-destructive cut plans, animation storyboards and FFmpeg renders. See [Dynamic Workflows](docs/DYNAMIC_WORKFLOWS.md).
- Layout styled using Tailwind v4 utility classes; dark UI follows provided visual reference. `src/components/ui` hosts shared controls; **no `features/` directory**.

## Not yet implemented

WhisperX alignment, Gemini/local-model adapters, hosted voice synthesis, microphone recording, GPU provisioning, advanced ripple editing, reset email delivery and full production deployment infrastructure require external services or future integration work. Buttons for unavailable tools are marked or disabled; no fake results or demo assets are passed off as real functionality.

## Commands

- `frontend`: `npm run dev`, `npm run typecheck`, `npm run build`.
- `backend`: `python -m app.init_db`, `python -m uvicorn app.main:app --reload`, `pytest` (requires `requirements-dev.txt`).
- API docs: `http://127.0.0.1:8000/docs`.
- Genuine n8n Workflow Page setup: [docs/N8N_INTEGRATION.md](docs/N8N_INTEGRATION.md).

## MySQL

Edit `backend/.env` if XAMPP root password/port differs. `scripts/install.ps1` copies .env.example **only when .env does not already exist**. `app.init_db` uses `CREATE DATABASE IF NOT EXISTS` and `metadata.create_all`, never drops tables. It does not migrate old schemas. Never point it at an old existing schema with different columns.

## Git

No script calls `git init`, `git reset`, `git clean`, `git add`, `git commit`, performs backup creation, or touches `.git`. Review with `git status --short`, then decide what to commit yourself. `.env`, `.venv`, `node_modules` and uploaded media are ignored.

## Security / deployment

This is a local-development application, **not a production-hardened deployment**. Before production: configure HTTPS, `ENVIRONMENT=production`, a strong `SECRET_KEY`, correct trusted origin, secure proxy and DB credentials; implement password-reset email sender, enforce quotas, content scanning, request throttling, origin controls and production storage/asset serving. Vite dev server should not be used as a public internet server.


## Timeline V2.2 – Smart mixed layers

Every new project starts with **three empty, unrestricted layers**. Any layer may contain video, image, audio and text clips; only the **clip** has a media type. Existing projects and previously saved legacy video/audio/text layers stay readable and can accept mixed clips without a MySQL schema migration.

- **Drag from Media or Components** onto any existing lane. Click a library item to append it instead.
- **Drag an existing clip** horizontally to move it in time, or vertically onto another lane.
- **Automatic layer creation:** while dragging, a purple “New layer on drop” lane appears below the last layer. Dropping there creates a layer (hovering alone does not). The `+ Layer` control remains optional. Maximum is 100 layers per project.
- **Trim from either edge:** drag the left/right 9-pixel handles to shorten/extend. Left-trimming video/audio updates non-destructive `source_offset`; video/audio cannot extend before source time zero. The right edge respects the original media duration when browser metadata is available. Images/text can be extended freely up to the timeline limit.
- **Zoom:** slider, `+`/`−`, Ctrl+mouse wheel and Fit Timeline. Zoom changes the *view* only, never the clip durations.
- **Rename:** double-click a clip or layer name; Enter to confirm, Escape to cancel. The Inspector also supports clip names and numeric timing.
- **Snap:** clip movement and trim edges snap near the playhead, time zero, or nearby clip boundaries.
- **Prevent overlaps:** dropping/trimming clips over an occupied interval in the **same layer** is rejected; a red ghost signals an invalid drop. Different layers may overlap in time.
- **Undo/Redo:** toolbar buttons, Ctrl+Z and Ctrl+Y / Ctrl+Shift+Z. Edits are saved with the existing project timeline autosave API.
- **Preview:** reads visual/audio/text clips from any layer, respecting visibility and mute controls.

### Test / run

From project root, keep the existing `backend/.env` and MySQL database; there is no destructive migration. Start MySQL in XAMPP and use the existing `start-cliptora.bat`, or `scripts/start-all.ps1`. After installing frontend packages once, run `cd frontend; npm run typecheck; npm run test:timeline; npm run build`. For backend tests run `cd backend; .\.venv\Scripts\python.exe -m pytest tests/test_schemas.py` if pytest is installed, or `python tests/smoke_local.py` with your activated environment.

The app currently supports browser media preview and non-destructive timeline editing. Server-side FFmpeg export / automatic Whisper transcription remain future work.


## V2.2.1 — Editor display / timeline zoom hotfix

Long media now expands **only the scrollable timeline**, not the top editor's Library/Preview/Inspector grid. On first import the visible time scale auto-fits to the media. Ctrl+wheel over timeline/tools changes timeline zoom only. Dragging between clips in the same layer shows free-gap boundaries, alignment snap line, and collision feedback. Outer borders, gutters and tool-rail scrollbar were reduced/removed. Details and manual regression checklist: `TIMELINE_VIEW_FIX.md`.


## V2.4.1 Preview canvas update

The editor now has explicit selection/move/resize/rotate/scale controls, an object picker, right-click actions within the Preview, keyboard nudging and a jump-to-clip action. See `PREVIEW_UPDATE_V2.4.1.md`.


## V2.4.1 Preview canvas update

The editor now has explicit selection/move/resize/rotate/scale controls, an object picker, right-click actions within the Preview, keyboard nudging and a jump-to-clip action. See `PREVIEW_UPDATE_V2.4.1.md`.


## Smart Library V3
See [SMART_LIBRARY_V3.md](SMART_LIBRARY_V3.md) for the implemented features, limitations and non-destructive MySQL setup.
