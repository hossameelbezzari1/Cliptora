# CLIPTORA n8n integration

CLIPTORA embeds the genuine self-hosted n8n editor at the existing React route
`/projects/:id/workflows/:workflowId?element=...`. n8n remains a separate service and owns
workflow nodes, connections, credentials, executions, logs, and editor behavior. CLIPTORA owns
only project/Timeline link metadata in `n8n_workflow_links`.

## License boundary

The Community edition is suitable for this installation only while it is personal/internal use:
only the owner (or people in the same organization) may create and edit workflows. n8n's official
license guidance says external customers configuring workflows, hosted n8n-as-a-service, and
white-label distribution require a commercial/Enterprise agreement. Do not expose this editor to
customers without written licensing confirmation from n8n.

- License guidance: <https://support.n8n.io/article/can-i-use-your-license-for-my-use-case>
- Sustainable Use License: <https://github.com/n8n-io/n8n/blob/master/LICENSE.md>
- OEM deployment documentation: <https://docs.n8n.io/embed/>

This integration does not remove n8n branding, bypass login, alter frame headers, or implement
token exchange. It uses n8n's `SAMEORIGIN` protection as shipped. Vite serves `/n8n/` through a
same-origin reverse proxy and strips the prefix only when forwarding upstream.

## First-time setup (Windows/XAMPP)

Requirements: Docker Desktop, XAMPP MySQL, the normal CLIPTORA frontend/backend dependencies, and
FFmpeg available on the Windows `PATH`.

1. Start or rebuild the pinned n8n 2.45.0 service from the repository root:

   ```powershell
   docker compose -f .\docker-compose.n8n.yml up -d --build
   docker compose -f .\docker-compose.n8n.yml logs -f n8n
   ```

   The existing local n8n data is preserved at `C:\n8n`. Override it with `N8N_DATA_DIR` only when
   intentionally choosing another persistent directory. The service binds only to
   `127.0.0.1:5678`, avoiding Apache (80/443), MySQL (3306), Vite (5173), and FastAPI (8000).

2. Start FastAPI and Vite normally:

   ```powershell
   .\scripts\start-all.ps1
   ```

3. Open <http://localhost:5173/n8n/> and sign in to the existing n8n owner account. On a fresh data
   directory, complete n8n's owner setup instead.

4. In n8n, open **Settings → API**, create an API key, and place it only in the ignored
   `backend/.env` file:

   ```dotenv
   N8N_BASE_URL=http://127.0.0.1:5678
   N8N_EDITOR_PATH=/n8n
   N8N_API_KEY=paste-the-n8n-api-key-here
   ```

   Restart FastAPI after changing `.env`. Never put this key in `frontend/.env`, React code, or
   browser storage.

5. In n8n, create a **CLIPTORA API** credential. Set:

   - API Base URL: `http://host.docker.internal:5173/api/v1`
   - Service Token: the value of `CLIPTORA_N8N_SERVICE_TOKEN` in the ignored `backend/.env`

   The service token is checked with a constant-time comparison. Browser CSRF remains enforced for
   every ordinary CLIPTORA mutation; only the `/api/v1/n8n/tools/` machine API accepts bearer auth.

6. Apply the additive schema explicitly for deployments that don't use `app.init_db`:

   ```powershell
   Get-Content .\backend\migrations\20261026_n8n_integration.sql | C:\xampp\mysql\bin\mysql.exe -u root cliptora_v2
   ```

   In development, the same tables are created on first authenticated integration request.

## Workflow lifecycle

- **Create workflow** creates an empty n8n workflow containing a Manual Trigger, stores its n8n ID
  in a CLIPTORA link row, writes the link ID to the Empty Element, and opens the real editor.
- **Edit workflow** resolves the CLIPTORA link, refreshes its title/status from n8n, and reopens the
  same n8n workflow.
- **Copy workflow** reads and recreates the n8n graph through the official n8n API. Credential
  references remain references; CLIPTORA never receives credential secrets. The selected Empty
  Element is relinked to the new workflow and the original n8n workflow remains unchanged.
- **Delete workflow** asks whether to delete the underlying n8n workflow or only unlink it. The
  Empty Element itself remains on the Timeline.

The old CLIPTORA React Flow editor remains in the source tree for backward compatibility, but is no
longer rendered on the active Workflow Page. n8n supplies the only visible canvas, picker,
configuration panel, credential UI, execution history, and logs.

## CLIPTORA Video Tools node

The custom package lives at `integrations/n8n-nodes-cliptora`. The Docker image loads it using
`N8N_CUSTOM_EXTENSIONS`; installed operations appear automatically in n8n's normal Add Node picker.

Current operations:

- **Get Project** — returns project dimensions, frame rate, and revision.
- **Get Timeline** — returns Timeline layers and media-asset references.
- **Extract Audio** — starts a real FFmpeg background job using a video media asset ID.
- **Check Job Status** — returns queued/running/completed/failed state and the resulting audio media
  asset ID. Large media bytes and filesystem paths never pass through n8n JSON.

To add `Auto Subtitle Styler` or another tool:

1. Add an authenticated, project-scoped FastAPI endpoint under `/api/v1/n8n/tools/`. For long work,
   create a background job and return a job ID immediately.
2. Add the operation and real parameter fields to
   `integrations/n8n-nodes-cliptora/nodes/Cliptora/Cliptora.node.js`.
3. Call the endpoint with media asset IDs and structured parameters, never client-supplied paths.
4. Add backend lifecycle/error/auth tests.
5. Run `docker compose -f .\docker-compose.n8n.yml up -d --build` and verify the operation through
   n8n's Add Node and node-configuration interfaces.

No second integration registry is needed. Official and supported community nodes continue to be
installed and discovered through n8n itself.

## Apache/XAMPP production-style proxy

Vite already proxies HTTP and WebSocket traffic during development. If Apache serves the built
frontend, enable `proxy`, `proxy_http`, and `proxy_wstunnel`, set
`CLIPTORA_PUBLIC_ORIGIN=http://localhost` before starting n8n, and add this to the CLIPTORA virtual
host (the trailing slashes matter):

```apache
ProxyPreserveHost On
ProxyPass        /n8n/ http://127.0.0.1:5678/ upgrade=websocket
ProxyPassReverse /n8n/ http://127.0.0.1:5678/
```

Do not remove n8n's CSP, cookie, authentication, or `X-Frame-Options` headers.

## Verification commands

```powershell
cd frontend
npm run typecheck
npm run test:timeline
npm run build

cd ..\backend
.\.venv\Scripts\python.exe -m pytest tests -q

cd ..
docker compose -f .\docker-compose.n8n.yml config
docker compose -f .\docker-compose.n8n.yml ps
```
