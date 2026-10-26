# CLIPTORA n8n integration

CLIPTORA vendors and builds a genuine source fork of n8n at `vendor/n8n`, then embeds that
self-hosted editor at the existing React route
`/projects/:id/workflows/:workflowId?element=...`. n8n remains a separate service and owns
workflow nodes, connections, credentials, executions, logs, and editor behavior. CLIPTORA owns
only project/Timeline link metadata in `n8n_workflow_links`.

## Fork source and branding

The fork is pinned to upstream tag `n8n@2.45.0`, commit
`7c79fd09a04e256a6b14bf29a40355a73a17d79d`. Its provenance and modification notice are in
`vendor/n8n/CLIPTORA_FORK.md`; upstream license and copyright files remain in place.

The Docker build compiles the checked-in monorepo and replaces the application payload in the
runtime image. It does not run the upstream prebuilt application. CLIPTORA's private custom node is
then added as a normal n8n extension.

Branding entry points:

- Browser title, metadata, and favicon: `vendor/n8n/packages/frontend/editor-ui/index.html`
- Favicon artwork: `vendor/n8n/packages/frontend/editor-ui/public/static/cliptora-mark.svg`
- Editor logo: `vendor/n8n/packages/frontend/@n8n/design-system/src/components/N8nLogo/`
- Main brand color: `vendor/n8n/packages/frontend/editor-ui/src/main.scss`

The React page uses a same-origin frame because the n8n editor is its own Vue application and
runtime. This is a transport boundary, not a remote or fake editor: the code displayed inside it is
the locally compiled fork in `vendor/n8n`.

## License boundary

The Community edition is suitable for this installation only while it is personal/internal use:
only the owner (or people in the same organization) may create and edit workflows. n8n's official
license guidance says external customers configuring workflows, hosted n8n-as-a-service, and
white-label distribution require a commercial/Enterprise agreement. Do not expose this editor to
customers without written licensing confirmation from n8n.

- License guidance: <https://support.n8n.io/article/can-i-use-your-license-for-my-use-case>
- Sustainable Use License: <https://github.com/n8n-io/n8n/blob/master/LICENSE.md>
- OEM deployment documentation: <https://docs.n8n.io/embed/>

This fork changes CLIPTORA-owned visual branding but does not remove upstream license notices,
bypass login, alter frame headers, or implement token exchange. It uses n8n's `SAMEORIGIN`
protection as shipped. Vite serves `/n8n/` through a same-origin reverse proxy and strips the
prefix only when forwarding upstream.

## Docker setup (Windows)

Docker Desktop is the only runtime requirement. MySQL, the Python/FastAPI backend, FFmpeg,
the React/Vite frontend, the source-built n8n fork, and the API-key bootstrap all run in Docker.

1. Build and start the complete stack from the repository root:

   ```powershell
   .\scripts\start-docker.ps1 -Build
   ```

   The first source build downloads the monorepo dependencies and can take several minutes. Later
   builds reuse Docker's package caches. Ordinary later starts need no build flag:

   ```powershell
   .\scripts\start-docker.ps1
   ```

   The existing local n8n data is preserved at `C:\n8n`. Override it with `N8N_DATA_DIR` only when
   intentionally choosing another persistent directory. On the first run, if Docker's MySQL is
   empty, the script imports the existing XAMPP `cliptora_v2` database automatically. Docker MySQL
   is exposed on `127.0.0.1:3307`, so it does not collide with XAMPP on 3306.

2. Open <http://localhost:5173/>. The workflow page embeds the editor through `/n8n/`.

   The one-shot `n8n-bootstrap` service creates or reuses a scoped API key and writes it to a
   Docker-only volume mounted read-only by FastAPI. No key needs to be copied into `backend/.env`,
   frontend code, browser storage, or Git.

3. In n8n, create a **CLIPTORA API** credential when using the CLIPTORA Video Tools node. Set:

   - API Base URL: `http://backend:8000/api/v1`
   - Service Token: the `CLIPTORA_N8N_SERVICE_TOKEN` value from the ignored `.env.docker`

   The service token is checked with a constant-time comparison. Browser CSRF remains enforced for
   every ordinary CLIPTORA mutation; only the `/api/v1/n8n/tools/` machine API accepts bearer auth.

To view logs or stop the stack:

```powershell
docker compose --env-file .env.docker logs -f
docker compose --env-file .env.docker down
```

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

## Unified CLIPTORA session

A user who is already authenticated in CLIPTORA enters the embedded n8n editor without a second
login form. The Workflow Page requests a 45-second, HMAC-signed, one-time editor ticket from the
authenticated FastAPI endpoint. The CLIPTORA n8n fork validates and consumes that ticket, issues its
normal HTTP-only `n8n-auth` cookie, and redirects to the requested workflow.

The browser never receives an n8n password or API key. The shared signing secret is available only
to the backend and n8n containers; `scripts/start-docker.ps1` generates a random installation secret
in `.env.docker` when one is missing. Opening n8n directly is not the supported entry point—open the
Workflow Page from the authenticated CLIPTORA application.

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
5. Run `.\scripts\start-docker.ps1 -Build` and verify the operation through
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
docker compose --env-file .env.docker config
docker compose --env-file .env.docker ps
```
