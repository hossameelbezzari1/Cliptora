# Cliptora V2 Architecture

```text
CLIPTORA/
  frontend/
    src/
      app/              # Auth context, routing
      components/
        ui/             # Shared Button, Field, Modal
        common/         # Header, logo
        editor/         # Sidebar, Library, Preview, Timeline, Inspector, Toolbar
        projects/       # Project modal
        media/          # Media card
        ai-scripts/     # Transcript-only prompt/JSON parser
        variables/ effects/ transitions/ animations/ subtitles/ transcription/ export/  # Planned module placeholders
      pages/            # Login, Register, Dashboard, Editor, AI Studio, Settings, Profile
      layouts/          # Auth, Dashboard, Editor layouts
      stores/           # Editor state (Zustand)
      lib/              # API client, formatting, dynamic URL
      styles/           # Tailwind v4 imports, theme tokens
      types/
  backend/
    app/
      api/v1/           # Auth, Projects, Timeline, Media, AI Scripts, Profile
      core/             # Config, database, security
      models/           # SQLAlchemy entities
      schemas/          # Pydantic validation
      services/         # Reserved for transcription/export integration
      init_db.py        # Create-only MySQL database schema
    tests/
  shared/schemas/       # JSON schema for AI result and timeline example
  storage/              # Local media/transcripts/exports (content ignored by Git)
  scripts/              # Install/check/start PowerShell scripts
  docs/design-reference.png
```

## Vite dynamic URLs

Vite binds `0.0.0.0`, picks available port, and shows Local/Network links. Frontend API uses relative `/api/v1` only, so all origins work with the same cookie origin via the Vite proxy. The proxy target is configurable in `frontend/.env` as `BACKEND_URL`; it is **not a hard-coded browser link**. `src/lib/api.ts` uses `window.location.origin` to produce absolute links when necessary.

## Git and MySQL

There is no `.git` in ZIP, and no Git CLI calls in scripts. The default DB `cliptora_v2` deliberately differs from any older `cliptora` DB. `init_db.py` never drops existing tables.

## What is implemented vs planned

Implemented: sessions/CSRF, project CRUD, media upload/playback, timeline persistence, clip timing/text, AI transcript prompt/scene JSON workflow. Planned: FFmpeg exports, whisper transcription, direct model APIs, visual transforms, keyframes, transitions, effects, high-end editing.
