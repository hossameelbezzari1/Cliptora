# CLIPTORA Smart Library V3 — installation and scope

## Install on top of V2.5

Extract `CLIPTORA_SmartLibrary_V3_Patch.zip` directly into the existing `C:\xampp\htdocs\CLIPTORA` folder, overwriting the included files. Run these commands from PowerShell after starting XAMPP MySQL:

```powershell
cd C:\xampp\htdocs\CLIPTORA
powershell -ExecutionPolicy Bypass -File .\scripts\upgrade-smart-library.ps1
cd frontend
npm run typecheck
npm run build
cd ..
.\start-cliptora.bat
```

This upgrade creates `user_library_items` with MySQL through SQLAlchemy `create_all`. It is non-destructive: no tables/rows are dropped or reset. Existing V2.4 timeline columns remain checked by the current migration. Save as Component and global variables are stored in this new table; per-clip effects, animations, repeat configuration and shapes are saved within `clips.properties_json`.

## Implemented functionality

- 30 animation and 50 effect named catalog descriptors with basic parameters and user-owned presets persisted in MySQL. Save/rename via API, delete and list via the UI.
- `My Components`, folders, named reusable groups and user-owned variables available to the same account across projects.
- Save selected clip snapshot as Component; apply it to an existing selected clip. This is *not* a full multi-clip/compound component loader. For media from another project, importing the file into the destination project may still be needed.
- Basic text, geometric shape and translucent CSS Blur Box clips in Preview, using existing text-clip persistence.
- Global typed variables (`string`, `number`, `boolean`, `color`, `date`, `datetime`, `duration`, `percentage`, `url`, `media`, `select`, `json`) with a safe, expression-limited evaluator. Text Preview interpolation supports `{{project.title}}`, `{{project.resolution}}`, `{{now()}}`, `{{now() + 1h}}`, and saved library variable references. Variables in *all* numeric/config properties are not yet wired up.
- Linked interval repeat rules on selected timeline clip. Repeated instances are computed in Preview using the linked clip's timeline start/end and dynamically adjust as it moves or changes duration. The repeated instances are virtual: not materialized as separate DB clips; Timeline recurrence blocks/indicators remain to be implemented. Missing target references do not crash the editor.
- CSS Preview implementations for limited common effects (Brightness, Contrast, Saturation, Gaussian Blur, Black & White, Sepia, Hue) when applied via saved effect presets. Other named effect descriptors are currently *presets/data*, not rendered effects.

## Not yet implemented / limitations

- Fully interactive multi-selection / group nesting in Timeline, compound clip editing, reusable media across projects with asset remapping, live linked Component master propagation.
- GPU/canvas/FFmpeg rendering for the complete 50 effect catalog or 30 animations, keyframes and exported output. Tracking/blur-follow is not active; box blur is a CSS preview approximation (not three production blur engines).
- Assigning variables to *every* component property, full expression grammar or safe recursive variable reference resolution. Only a deliberately small grammar is supported (no `eval`).
- A final, type-checked Windows Vite build and real browser mouse validation: npm dependencies are not installed in the packaging container, so run the two commands above.

## API endpoints

- `GET /api/v1/library` or `?kind=component|group|folder|effect|animation|variable`
- `POST /api/v1/library`
- `PATCH /api/v1/library/{item_id}`
- `DELETE /api/v1/library/{item_id}`

Routes require existing authentication and CSRF for writes. Library rows are filtered by authenticated `user_id`. Nested parent relations reject invalid parents and cycles. No Git reset/commit, no `.env` overwrite, and no database file included.
