# Dynamic Workflow Studio

CLIPTORA's Workflow Studio is available from the editor's **AI Scripts** tool.
It stores project-owned definitions and immutable versions in MySQL, presents a
React Flow DAG canvas, imports/exports CLIPTORA workflow JSON, duplicates saved
workflows, and records every run with per-node artifacts and progress.

## Processing dependencies

- FFmpeg and FFprobe must be installed on `PATH` for probing, audio extraction,
  cut rendering, reframing, and final MP4 output.
- `faster-whisper` provides word-level timestamps. The first run downloads the
  configured model (`tiny`, `base`, `small`, `medium`, `large-v3`, or `turbo`).
- OpenAI nodes use `OPENAI_API_KEY` and `CLIPTORA_OPENAI_MODEL`. Offline mode is
  a deterministic transcript heuristic and is labelled as such in artifacts.
- Local development defaults to FastAPI background execution. Production should
  set `WORKFLOW_QUEUE=celery`, run Redis, and run the Celery worker documented in
  `backend/README.md`.

Apply `backend/migrations/20261024_dynamic_workflows.sql` to an existing database.
Fresh installations create the workflow tables through SQLAlchemy.

## Safety and data behavior

Only registered node types can execute; workflow JSON cannot contain Python or
shell commands. Uploaded and Media Library sources are copied or hard-linked to
project/user-scoped workflow storage and are never modified. Timeline cut plans
preserve source timestamps and are applied as new non-destructive clips, so they
remain editable and participate in the editor's undo/redo and autosave behavior.

## Current external limitations

The bundled executor performs transcript-driven analysis and FFmpeg rendering.
WhisperX alignment, third-party voice synthesis, microphone capture, image/video
generation models, and GPU acceleration require separate provider/runtime
installations and are not silently simulated. The Studio exposes only nodes whose
implementations are present in the backend registry.
