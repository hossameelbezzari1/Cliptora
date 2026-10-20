# Cliptora Backend

FastAPI, SQLAlchemy 2 and MySQL via PyMySQL. Database: `cliptora_v2` by default so a prior `cliptora` database is preserved.

1. Start MySQL in XAMPP.
2. Create virtual env: `py -m venv .venv`.
3. Install: `.\.venv\Scripts\python.exe -m pip install -r requirements.txt`.
4. Copy `.env.example` to `.env` and adjust `DATABASE_URL` as needed. For production, use HTTPS and a random `SECRET_KEY`.
5. Initialize: `.\.venv\Scripts\python.exe -m app.init_db` (creates missing database/tables, never drops data).
6. Run: `.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload`.

Docs: http://127.0.0.1:8000/docs

Routes: Auth (cookie sessions and CSRF), Projects, Timeline, Media (private files), Profile, AI Scripts.

Important: password reset returns a **development-only** token; email delivery is not implemented. Video encoding/export, speech-to-text transcription and direct model API execution are not implemented in this release. Keep the Vite development proxy for same-origin browser requests.
