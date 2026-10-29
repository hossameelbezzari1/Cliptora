# Native Workflow Studio audit

Updated: 2026-10-27

## Current source of truth

New CLIPTORA workflows are owned by FastAPI and stored in the main MySQL database (`cliptora_v2`) through `workflow_definitions`, `workflow_versions`, `workflow_sources`, and `workflow_runs`. Timeline Empty Elements store the linked native definition ID in `props.workflow_id`. The native route renders `WorkflowStudio` directly; it does not create an n8n session or render an iframe.

The n8n 2.45.0 fork, API bridge, custom CLIPTORA node package, data directory, and Docker services remain intact only as transitional infrastructure for historical n8n workflows. They have not been deleted or migrated silently.

## Feature inventory

| Capability | Status | Existing implementation / next work |
| --- | --- | --- |
| Native Workflow page | Active | `frontend/src/pages/workflows/index.tsx` renders the React Flow studio. |
| Graph canvas | Reused | React Flow pan, zoom, drag, connect, edge/node delete, selection, minimap, fit view, and live node status. |
| Tool discovery | Active | FastAPI `/workflows/catalog` feeds the searchable categorized Tool Library. It includes all 445 node entries declared by the vendored `n8n-nodes-base` 2.45.0 manifest. Entries without a native executor are visibly marked unavailable and cannot be added or run. |
| Node configuration | Reused | Full-screen INPUT / PARAMETERS / SETTINGS / OUTPUT editor with JSON, table, and schema views. |
| Persistence and versions | Reused | Native definition CRUD, independent duplication, version snapshots, and restore in MySQL. |
| Timeline linking | Active | First native save stores the definition ID on the Empty Element; edit restores it; copy creates an independent definition; shared workflows are unlinked rather than deleted. |
| Durable execution | Reused | `workflow_runs` supplies durable IDs, progress, cancellation, retry, checkpoints, node results, and artifacts. Local background execution and optional Celery/Redis are supported. |
| Python media execution | Reused | FFprobe/FFmpeg, extraction, word-timed transcription, transcript-only highlights, cut planning, captions, storyboard/keyframes, and optional render. |
| Apply cut plan | Reused | Completed cut artifacts can add source-linked non-destructive clips to the CLIPTORA Timeline. |
| JavaScript integration worker | Not implemented | A separate authenticated/sandboxed Node.js worker is still required before JS-based provider nodes can be marked executable. |
| Credentials vault / OAuth | Not implemented | Native encrypted credential records, key rotation, OAuth callbacks, and redaction are required. Secrets must not be placed in workflow node settings. |
| n8n JSON importer | Not implemented | Must preserve positions/parameters, map only supported types, report unsupported nodes and missing credentials, and never auto-execute imports. |
| Per-node test execution | Active | Execute Step creates a durable run containing the selected node and only its transitive dependencies, with the normal progress/results/artifact contract. |
| Native HTTP Request | Active | Executes GET/POST/PUT/PATCH/DELETE against explicitly allowlisted HTTPS hosts, blocks redirects/private networks/secret headers, and bounds request/response sizes and timeouts. Configure `CLIPTORA_WORKFLOW_HTTP_ALLOWED_HOSTS`. |
| Native Switch / Merge / Filter | Active | Switch supports ordered rules, routes 0-4 and fallback; Merge supports append/combine/choose-first; Filter applies safe dot-path comparisons to bounded arrays. |
| Native OpenAI | Active when configured | General chat/prompt execution with optional upstream JSON input, bounded parameters, real usage metadata, and backend-only `OPENAI_API_KEY`. |
| Advanced graph editing | Partial | Multi-select is provided by React Flow; explicit undo/redo, clipboard duplication, context menus, auto-layout, typed port enforcement, and loop semantics remain. |

## Node compatibility assessment

The generated read-only inventory is stored in `backend/app/workflows/registry/n8n_nodes.json` and can be reproduced with `scripts/generate_n8n_node_catalog.py`. Every entry retains its upstream package, version, manifest path, and license metadata. The generator reads the package manifest only; it never imports or executes n8n code. The vendored package also declares 413 credential types, but those are not exposed as usable credentials until CLIPTORA has an encrypted vault, OAuth lifecycle, scope validation, and redaction.

| Family | Feasibility | Required approach |
| --- | --- | --- |
| Manual/Schedule/Webhook triggers | Partial | Manual Trigger is native and executable. Schedule and Webhook still require persisted trigger records plus scheduler/webhook ingress. |
| IF/Switch/Filter/Merge/Loop | Partial | IF, Switch, Filter, and Merge are native and executable. A true item Loop still needs engine-level repeated downstream execution and bounded iteration semantics. |
| HTTP Request | Partial | The unauthenticated native executor is active with HTTPS host allowlisting, SSRF protection, disabled redirects, timeouts, size limits, and secret-header blocking. Credential injection waits for the encrypted vault. |
| OpenAI/Gemini/Anthropic | High | Native provider adapters using supported APIs/SDKs and encrypted native credentials. Current offline/OpenAI highlight logic is not a general provider node. |
| Gmail/Google Sheets | Medium | Native Google OAuth, scopes, token refresh, pagination, quotas, and operation schemas are preferable to copying node source. |
| Microsoft Excel/Outlook | Medium | Native Microsoft Graph OAuth and provider adapters. |
| Telegram/Discord | High | Native HTTP/provider adapters with encrypted tokens and operation-specific validation. |
| AI Agent and arbitrary n8n/community nodes | Low without n8n | These depend on n8n execution contexts, expression services, credentials, binary data, and node-specific packages. Do not advertise them as executable until a licensed, tested compatibility runtime exists. |
| Code node | Deliberately blocked | Requires a resource-limited sandbox with no unrestricted host/file/network access. |

## Safety and migration boundary

- The native page no longer depends on the n8n editor, login, projects, or dashboard.
- The transitional n8n service and persistent data remain operational; no volume or historical workflow was removed.
- Existing timeline links created by the former n8n bridge are not assumed to be native definition IDs. They need an explicit migration report/import flow before conversion.
- Removing the n8n service, SSO route, bridge tables, or vendored fork requires successful exports, supported-node conversion, execution comparison, and explicit approval.

## Next actionable phase

Add native control-flow nodes plus a secured HTTP Request executor, then introduce encrypted credentials before provider integrations. In parallel, add the read-only n8n export/import report so historical workflows can be classified without modifying either database.
