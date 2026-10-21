# CLIPTORA V2.2.0 – Smart Multi-Layer Timeline

## Apply the small update ZIP to the installed CLIPTORA V2.0.1

This ZIP contains only changed frontend/backend source, documentation and timeline tests. It does **not** contain `.git`, `.env`, `node_modules`, `.venv`, media files, or database files, and it does not reset/commit anything.

1. Stop Cliptora using Ctrl+C in the running console.
2. Put `CLIPTORA_Timeline_V2.2_Patch.zip` in your Downloads folder.
3. Run PowerShell:

```powershell
cd C:\xampp\htdocs\CLIPTORA
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\CLIPTORA_Timeline_V2.2_Patch.zip" -DestinationPath . -Force
git status --short
```

4. Start MySQL in XAMPP, then double-click the existing `start-cliptora.bat` (one console), or run `scripts\start-all.ps1`. Do not re-run the full installer. There are **no new npm/Python packages** and **no database migrations** for this update.
5. After `npm install` has already completed on this PC, check the frontend:

```powershell
cd C:\xampp\htdocs\CLIPTORA\frontend
npm run typecheck
npm run test:timeline
npm run build
```

6. Test a new project (3 empty layers); drag media into any layer, move it to another, trim the ends, drop below the last layer to create another, rename with double-click, and test +/−/Fit/Ctrl+wheel zoom. Changes use the existing autosave endpoint. Older projects/track types remain accepted.

## What changed

- `frontend/src/components/editor/timeline/TimelinePanel.tsx`: draggable clips, horizontal/vertical placement, snap, ghost preview, zoom, auto layer below, two-sided trimming, rename, controls, shortcuts.
- `frontend/src/components/media/MediaCard.tsx`, `frontend/src/components/editor/library/LibraryPanel.tsx`, `frontend/src/lib/media.ts`: drag media/text from library and probe video/audio duration.
- `frontend/src/stores/editorStore.ts`, `frontend/src/types/index.ts`: independent clip types, generic layers, positioning, trim with source offsets, collision prevention, undo/redo.
- `frontend/src/components/editor/preview/PreviewPanel.tsx`, `frontend/src/components/editor/inspector/InspectorPanel.tsx`: mixed-layer preview and updated editing hints.
- `frontend/src/components/ai-scripts/PlanTools.ts`: AI-generated video cuts target any unlocked mixed layer.
- `backend/app/api/v1/projects.py`: add 3 default layers for new/duplicated projects.
- `backend/app/api/v1/timeline.py`, `backend/app/schemas/objects.py`: allow mixed clips in all layers, create 3 defaults on first fetch of an empty older project; increase limit to 100 layers.
- `frontend/tests/editor-store.test.cjs`, `backend/tests/{test_schemas.py,smoke_local.py}`: tests.

## Editing behavior and limits

- Default 3 layers per project. Any layer may contain video, audio, image or text clips in a non-overlapping sequence. Different layers may overlap in time.
- To create a layer without pressing `+`, drag any clip into the purple “New layer on drop” zone below the bottom layer. The layer is created **only when dropped**.
- Drag clip body to move; grab left or right 9px trim handle to edit time/duration. Video/audio left trims track source offset non-destructively. Video/audio right trims clamp to the source length if metadata can be read; otherwise preview may be limited by actual file length.
- No ripple-shift yet: placing clips over another clip in the same layer is rejected; move the other clip or use another layer.
- 100 layers; up to 500 clips across one saved project are currently supported by the backend. Advanced transitions/ripple editing/Whisper/FFmpeg export are not part of this update.
- Ctrl+mouse wheel zoom has a non-passive listener to prevent browser zoom; timeline view scale changes only.
- Existing database schema stores `tracks.type` in `VARCHAR(20)`, which can hold `mixed`. This update does **not** drop/alter tables or reset stored projects.

If a build reports errors, send the complete terminal output together with `git status --short`.
