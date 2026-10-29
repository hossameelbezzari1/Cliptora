# Workflow Studio Design QA

- Source visual truth: `C:/Users/Hossame/AppData/Local/Temp/codex-clipboard-81c11ef0-4caf-44ca-a5fc-0804756cc02f.png`
- Wiring reference: `C:/Users/Hossame/AppData/Local/Temp/codex-clipboard-9cdf16ce-93f5-413e-a717-8b0c9b71b3b2.png`
- Implementation screenshot: `C:/xampp/htdocs/CLIPTORA/workflow-studio-reference-qa.png`
- Wiring-state screenshot: `C:/xampp/htdocs/CLIPTORA/workflow-studio-wiring-qa.png`
- Full side-by-side evidence: `C:/xampp/htdocs/CLIPTORA/workflow-studio-comparison-qa.png`
- Focused inspector evidence: `C:/xampp/htdocs/CLIPTORA/workflow-studio-inspector-comparison.png`
- Browser viewport: 957 x 693 CSS pixels, device scale factor 1
- Reference pixels: 2997 x 1685; wiring reference: 864 x 1509
- State: Movie Recap workflow loaded; Select Best Moments selected; Settings and Wiring inspected; Add task library opened and searched.

## Findings

No actionable P0, P1, or P2 visual mismatches remain.

- Layout: the old dark multi-pane editor was replaced by the requested light pipeline canvas, compact top command bar, floating Add task library, and fixed right task inspector.
- Graph: tasks use compact icon tiles, status-colored outlines, captions, directional handles, dependency-depth placement, and orthogonal smooth-step connections.
- Inspector: title/status header, Settings/Wiring tabs, task-first controls, progressive advanced JSON, connection summaries, and sticky Cancel/Save task actions follow the reference structure.
- Tool architecture: the library continues to use the dynamic workflow catalog, separating enabled actions from planned tools without presenting planned actions as functional.
- Responsive behavior: the inspector becomes an overlay on narrow viewports, while the desktop split remains stable at the QA viewport.
- Accessibility: controls keep semantic buttons, labels, visible selected states, and readable contrast.

## Comparison History

1. Pass 1, P1: the existing permanent dark library, bottom execution deck, and technical inspector did not match the supplied pipeline UI. Rebuilt the shell around a light canvas and right-side task editor.
2. Pass 2, P1: freeform bezier edges and the previous grid weakened graph hierarchy. Replaced them with dependency-depth placement and smooth-step wiring.
3. Pass 2, P2: status context was weak and raw JSON was too prominent. Added task/run status pills and moved JSON into progressive advanced settings.
4. Final pass: verified Settings, Wiring, Add task, graph selection, and production build. No clipped persistent controls or runtime page failures were observed.

## Follow-up Polish

- P3: CLIPTORA uses its category icon system instead of reproducing third-party product marks from the reference.
- P3: the graph is denser at the compact QA viewport because the real Movie Recap workflow contains more sequential stages than the sample pipeline.

final result: passed

---

# Ollama Node Design QA — 2026-10-29

- Source visual truth: `C:/Users/Hossame/AppData/Local/Temp/codex-clipboard-21a9d8ca-3bfe-411f-a96c-4fa20ae8f05d.png`
- Rendered implementation: live Docker build at `http://127.0.0.1:5173/projects/1/workflows/1`
- Verified state: mounted AI category and Ollama `Actions (2)` picker in the in-app browser, without adding a node or modifying the saved workflow.

## Findings

No actionable P0, P1, or P2 visual or interaction mismatches remain.

- Action picker: reproduces the requested Image actions / Analyze image and Text actions / Message a model groups, plus the custom-call footer copy.
- Functional truth: both enabled actions call the local Ollama `/api/chat` executor; vision URLs are downloaded through a public-HTTPS-only guard and sent as base64 image content.
- Model discovery: the editor reads installed model names from `/api/tags`, uses a selectable list when reachable, and keeps an exact model-ID input as the offline fallback.
- Honest unavailable state: the current host has no reachable Ollama service on port 11434, so the editor reports that condition and disables execution until the local service responds.
- Persistence safety: visual verification opened only the Tool Library and picker; it did not create a node, trigger autosave, or mutate MySQL workflow data.

## Comparison History

1. Pass 1: registered the two-action Ollama catalog and screenshot-matched grouping/copy.
2. Pass 2: connected both actions to the local chat/vision API, added model discovery, validation, Docker host routing, and backend tests.
3. Final pass: rebuilt Docker and verified the actual mounted React picker through its accessibility tree and a browser screenshot.

final result: passed

---

# Google Gemini Node Design QA — 2026-10-29

- Source visual truth: `C:/Users/Hossame/AppData/Local/Temp/codex-clipboard-0000f3ff-b2ff-4fd5-8c2c-3582f5dd8ec0.png` and `C:/Users/Hossame/AppData/Local/Temp/codex-clipboard-b272a137-bcd8-4add-88a6-75e3b046e83f.png`
- Rendered implementation: live rebuilt Docker app at `http://127.0.0.1:5173/projects/1/workflows/1`
- Implementation evidence: in-app browser capture on 2026-10-29 showing the mounted `Actions (15)` Gemini picker.
- Verified states: AI category contains Google Gemini; correct four-point Gemini brand mark; all 15 actions in the requested seven groups; implemented actions enabled; unsupported binary/async actions disabled with reasons.

## Findings

No actionable P0, P1, or P2 visual or interaction mismatches remain.

- Action picker: reproduces the requested Audio, Document, File Search, Image, Media File, Text, and Video sections in the same order.
- Functional truth: Message a model, Generate an image, and Create/List/Delete File Search store call the real Gemini REST API through backend-only credentials.
- Current models: text defaults to `gemini-3.8-flash`; image generation defaults to `gemini-3.1-flash-image`, with current alternatives selectable in the editor.
- Honest disabled states: upload, media understanding, image editing, and asynchronous video actions remain visibly disabled until their binary/artifact pipeline is implemented.
- Credential safety: `GEMINI_API_KEY` is checked server-side, exposed only as a boolean readiness state, and wired into Docker without storing it in workflow JSON.
- Persistence safety: visual verification opened only the Tool Library and action picker; it did not add a node or mutate the saved MySQL workflow.

## Comparison History

1. Pass 1: added the 15-action catalog, exact labels/groups, and Gemini brand icon.
2. Pass 2: replaced placeholder behavior with five real backend executors and action-specific editor fields/model selectors.
3. Final pass: rebuilt Docker, reloaded the actual React route, and verified the mounted picker through accessibility state and a browser screenshot.

final result: passed

---

# AI Agent Node Design QA — 2026-10-29

- Source visual truth: `C:/Users/Hossame/AppData/Local/Temp/codex-clipboard-64d9ee09-6939-48fd-a9b1-3691e55387f9.png` and `C:/Users/Hossame/AppData/Local/Temp/codex-clipboard-06ffb67d-575a-4de6-86bc-829d72a4caf8.png`
- Rendered implementation: live production Docker build at `http://127.0.0.1:5173/projects/1/workflows/1`
- Verified states: AI category listing; large AI Agent canvas card; required-model warning; Chat Model/Memory/Tool ports; Chat Model quick-add; connected edge; three-panel editor; right-click context menu.

## Findings

No actionable P0, P1, or P2 visual or interaction mismatches remain.

- Canvas node: uses the larger rounded agent card, main input/output handles, required Chat Model port, optional Memory and Tool ports, warning state, and functional plus controls.
- Connection behavior: the Chat Model plus is filtered to the runnable OpenAI Chat Model node and persists its target-handle role with the workflow graph.
- Editor: provides Source for Prompt, Prompt, structured-output and fallback switches, progressive Options, execution gating, and live connection status in the requested Input / Parameters / Output layout.
- Functional truth: AI Agent and OpenAI Chat Model are registered backend executors. The agent validates the model connection, consumes connected memory/tool JSON, supports fallback models, and validates structured JSON output when enabled.
- Context menu: right-click on the mounted AI Agent exposed Open, Execute step, Rename, Replace, Pin, Copy/Paste settings, Duplicate, Tidy Up, Select All, Clear Selection, and Delete; unsupported actions stayed disabled with reasons.
- Persistence safety: temporary QA nodes created through the mounted UI were removed by restoring workflow `#1` to its exact pre-test version 31 and 16-node MySQL snapshot.

## Comparison History

1. Pass 1: added real AI Agent and OpenAI Chat Model catalog nodes, special target-handle persistence, and backend execution.
2. Pass 2: added the n8n-inspired card, required connection warning, quick-add input controls, and specialized editor form.
3. Final pass: verified the actual mounted React route, autosave, generated edge, enabled Execute step after connection, context menu, production build, and database restoration.

final result: passed

---

# OpenAI Node Design QA — 2026-10-29

- Source visual truth: `C:/Users/Hossame/AppData/Local/Temp/codex-clipboard-a6c56730-e607-4bab-af7c-098fdcaa6b0e.png` and `C:/Users/Hossame/AppData/Local/Temp/codex-clipboard-be64ace5-b3fa-4125-9969-52d8e6ce4107.png`
- Rendered implementation: live production Docker build at `http://127.0.0.1:5173/projects/1/workflows/1`
- Desktop QA viewport: 1440 x 900 CSS pixels, device scale factor 1
- Verified states: grouped OpenAI action picker; Analyze image three-panel editor; enabled/disabled actions; responsive single-panel editor; restored original workflow after the temporary test node.

## Findings

No actionable P0, P1, or P2 visual or interaction mismatches remain.

- Action picker: shows `Actions (16)` with Text, Image, Audio, File, and Assistant groups, OpenAI brand icons, and clear unavailable reasons for disabled actions.
- Node editor: matches the reference three-column Input / Parameters / Output structure, with a compact header, Parameters and Settings tabs, Execute step, resource/operation selectors, image prompt, URL input, model, and Simplify Output.
- Responsive behavior: the same mounted editor switches to Input / Parameters / Output navigation below the desktop breakpoint without clipping the form.
- Functional truth: Message a model, Classify text for violations, Analyze image, Generate an image, and Edit image are enabled and connected to backend executors. Edit image securely downloads bounded public HTTPS inputs, supports an optional PNG mask, and sends the real multipart request; unrelated audio/file/conversation/video actions remain disabled until their artifact pipelines exist.
- Persistence safety: the verification node and accidental verification duplicate were removed, and workflow `#1` was restored to version 30 with its original 15 nodes.

## Comparison History

1. Pass 1, P1: OpenAI exposed only a generic chat action. Added the 16-action grouped selector and per-action capability metadata.
2. Pass 2, P1: the generic editor showed all OpenAI fields for every action. Added action-specific forms and the screenshot-matched Analyze image defaults.
3. Pass 2, P1: Analyze image had no real executor. Added a server-side vision request with HTTPS URL validation and tests for the exact multimodal payload.
4. Final pass: verified the production Docker build through the actual mounted React route at desktop and narrow viewports.
5. Follow-up pass: replaced the `Binary image uploads are not connected yet` placeholder with the real OpenAI image-edit executor and verified the mounted `Edit image` action is enabled.

## Follow-up Polish

- P3: the CLIPTORA footer remains visible below the modal to retain execution context; the reference does not include this product-specific footer.
- P3: the Tool Library can be narrowed to 280 px by the user, so long action labels may wrap more than in the wider reference panel.

final result: passed
