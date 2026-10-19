# Cliptora — AI Video Editor

Phase 1 is a working React/TypeScript + FastAPI foundation based on `design-reference.png`. It includes secure cookie sessions, CSRF protection, account recovery, an ownership-scoped project dashboard, profile editing, and a persistent multi-track editor shell.

## Requirements

- Node.js 20+
- Python 3.11+
- MySQL 8 (the MySQL included with XAMPP is suitable for local development)
- FFmpeg is not needed until Phase 2 media work

## MySQL setup (PowerShell)

```powershell
& 'C:\xampp\mysql\bin\mysql.exe' -u root -e "CREATE DATABASE IF NOT EXISTS cliptora CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
Copy-Item .env.example backend\.env
# Edit backend\.env if the local MySQL user has a password.
```

## Backend

```powershell
cd C:\xampp\htdocs\CLIPTORA\backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[test]"
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API health: `http://127.0.0.1:8000/health`.

## Frontend

```powershell
cd C:\xampp\htdocs\CLIPTORA\frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173`. Development password-reset links are returned only when `DEV_EXPOSE_RESET_LINK=true`; production must disable this and connect an SMTP sender.

## Verification

```powershell
cd C:\xampp\htdocs\CLIPTORA\backend
.\.venv\Scripts\Activate.ps1
pytest

cd ..\frontend
npm run typecheck
npm run build
npm run test:sites
```

## Implemented in Phase 1

- Register, login, secure persistent session, logout, forgot/reset password, profile update
- HttpOnly session cookie, double-submit CSRF check, restricted CORS, basic auth rate limiting
- User-owned create/list/open/rename/duplicate/delete projects with IDOR protection
- Editor project loading, timeline track create/delete/show/lock, playhead seeking, autosave with revision checks
- Responsive auth and dashboard; dense desktop editor matching the supplied charcoal, purple, cyan, and orange design language
- Demo visuals are explicitly labelled and can be hidden. Import, effects, AI, and export are visibly unavailable until their scheduled phases.

## Next phases

Media upload/streaming and true clips are Phase 2. Text/effects/transitions are Phase 3, local transcription Phase 4, AI Studio Phase 5, and FFmpeg export Phase 6. Buttons for those features are disabled or labelled instead of simulating work.
