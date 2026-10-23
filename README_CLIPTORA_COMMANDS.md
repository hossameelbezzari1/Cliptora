# CLIPTORA V3.1 — Commands / Automation for every Timeline element

## What this first functional release supports

- Global, reusable **Command definitions** in MySQL, owned by the logged-in user.
- **Bindings** of one or more Commands to any selected clip (video/image/text/shape/audio/blur/group clip), with per-binding inputs, output-variable mappings and trigger configuration.
- Run Command manually. Runs are performed by a FastAPI background worker, and progress/results/errors are stored as auditable rows in MySQL. React polls when a run is active.
- Three safe executors: JSON field extraction, allowlisted HTTPS JSON GET/POST, and Selenium reader for visible YouTube comments using a dedicated authorized local Chrome profile or **locally configured** `.pkl` containing Selenium cookie dictionaries.
- Output mapping to existing global MySQL Variables: e.g. `comments.0.text -> youtube_comment`, then `{{youtube_comment}}` can be rendered by CLIPTORA Text Variables.
- Saved trigger definitions: `manual`, `on_start`, `on_end`, `on_repeat`. **Only manual is called directly from the current Clip Settings UI.** An event API is exposed for future Timeline/AI Script automation; automatic playback dispatch is NOT wired in this version to avoid repeated accidental browser sessions on scrubbing.

### Security boundaries

- Only authenticated user-owned Commands/Projects/Bindings are accessible. Existing CSRF middleware covers writes.
- No arbitrary shell/Python scripts or user-provided SQL from the web UI. More command types can be added as reviewed executors.
- API calls: explicit HTTPS allowlist in `backend/commands.env`, no private/loopback IPs, no redirects, 12s timeout, 200KB output limit, 2 queued/running jobs per user.
- Google credentials are **never stored in MySQL or sent to the frontend**. Only a server-controlled local profile or local `.pkl` path can be configured. The `.pkl` reader rejects Python class/function globals, and only recognizes Selenium cookie dictionaries for youtube.com. Old cookies may expire; Google authentication is not guaranteed. Do not attempt bypasses of login challenges/CAPTCHAs.
- Do not commit `backend/commands.env` or cookie/session files to Git. Store profile and cookies outside the web server's public directory and restrict filesystem permissions.

## Files to download (direct files, no ZIP)

Place these five files in one folder such as `Downloads`:

1. `Install-CliptoraCommands.py`
2. `commands.py`
3. `command_engine.py`
4. `ClipCommandsSection.tsx`
5. `commands.env.example`

The installer copies the last four to their correct destinations and adds API registration and Clip Settings JSX import, only if it finds the expected V3 Inspector markup. It *refuses to modify files* when the markup differs. Existing code is not automatically backed up; you already have Git history.

```powershell
cd $env:USERPROFILE\Downloads
py .\Install-CliptoraCommands.py --project-root 'C:\xampp\htdocs\CLIPTORA' --source-folder . --dry-run
py .\Install-CliptoraCommands.py --project-root 'C:\xampp\htdocs\CLIPTORA' --source-folder . --apply
```

**Restart the Python backend**, as this installs a new router. MySQL must be running. The backend uses SQLAlchemy `create_all(... tables=[...], checkfirst=True)` for **only** `automation_commands`, `automation_bindings`, `automation_runs`; it does not alter existing project/timeline tables.

Optional Selenium functionality:

```powershell
cd C:\xampp\htdocs\CLIPTORA\backend
.\.venv\Scripts\python.exe -m pip install 'selenium>=4.20,<5'
Copy-Item .\commands.env.example .\commands.env
```

Edit `backend/commands.env` with a dedicated browser profile and/or local `.pkl` path, then restart Python. If using cookies from `.pkl`, **do not upload that file through the browser**. File references must exist on the machine running the backend, not the client's browser computer.

For frontend:

```powershell
cd C:\xampp\htdocs\CLIPTORA\frontend
npm run typecheck
npm run build
```

Reload Chrome with Ctrl+Shift+R. In Editor select a clip, open `Clip Settings → Commands / Automation`, create a reusable command, link it to the clip, configure `Inputs`, choose optional output variables, and press Run.

## Example: YouTube comments

Command type: `Selenium — YouTube comments`

Global Command config:

```json
{ "max_comments": 20 }
```

Inputs attached to a specific clip:

```json
{ "video_url": "https://www.youtube.com/watch?v=REPLACE_WITH_ID" }
```

Output mapping:

```json
{ "comments.0.text": "youtube_comment", "count": "comments_count" }
```

The run returns an object containing `video_id`, `comments[]` (author, text), and `count`. Site layout/login changes and disabled comments can yield no results. Observe YouTube's applicable terms and rate limits; prefer official YouTube Data API when suitable.

## Endpoints

All routes are under `/api/v1/commands`:

- `GET/POST /library` and `DELETE /library/{command_id}`
- `GET/POST /bindings`, `PATCH/DELETE /bindings/{id}`
- `POST /bindings/{id}/run` (HTTP 202, manually queue command)
- `GET /runs?project_id=...&clip_id=...`, `GET /runs/{id}`
- `POST /events` for an authorized, deliberate `on_start` / `on_end` / `on_repeat` event

## Validation and limitations

The backend service and API syntax were checked, TSX parser checked. Isolated FastAPI regression checks exercise command creation, bindings, runs and access control against temporary SQLite. **Full integration with the user's exact project and Windows Chrome/Selenium is not yet validated**, since the complete current repository is not attached here. The installer enforces known V3 integration anchors and refuses unknown layouts instead of guessing.
