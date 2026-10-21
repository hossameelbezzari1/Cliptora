# CLIPTORA V2.2.1 — Timeline / Editor view correction

This is a **frontend-only, non-destructive** patch for Cliptora V2.2.0. Existing MySQL data, FastAPI code, media files, `.env` and `.git` are not modified. Patch layout is rooted at `frontend/` for direct extraction into your project root.

## Fixes

- **Editor layout no longer widens** when a long video clip is inserted or timeline zoom is increased. Grid parents use `min-width: 0`, the timeline is contained to its own viewport, and the time ruler scrolls horizontally inside it.
- **Preview and Inspector remain on screen** when importing long media. The Library no longer expands with timeline width.
- **Tighter visual layout**: greatly reduced outer gutters, panel rounding, gratuitous borders and padding. The sidebar scrollbar is hidden but the sidebar itself still scrolls.
- **Timeline-only zoom**: Ctrl+mouse wheel within the timeline *or timeline toolbar*, zoom buttons, logarithmic zoom slider, Fit. Browser/page zoom is prevented for those wheel gestures while the timeline is hovered.
- **First imported clip is automatically fitted** to the visible timeline width unless the user previously selected their own timeline zoom. It changes pixels per second only, never source/clip durations.
- **Drag/drop gap guides** show dashed boundaries between adjacent clips on the target layer, amount of free time and a bright alignment marker at snapped edges. Invalid overlap still displays a red ghost, and is still rejected.
- All existing mixed layers, auto new-layer on drop, moving clips, edge-trimming, rename, undo/redo and autosave stay intact.

## Apply (Windows PowerShell)

1. Close any running React/Vite process (`Ctrl+C`). Keep your Git repository and `.env` files.
2. Download `CLIPTORA_Timeline_ViewFix_V2.2.1_Patch.zip` to Downloads.
3. Run from the repository root:

```powershell
cd C:\xampp\htdocs\CLIPTORA
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\CLIPTORA_Timeline_ViewFix_V2.2.1_Patch.zip" -DestinationPath . -Force
git status --short
cd frontend
npm run build
```

4. Return to the project root and start your existing `start-cliptora.bat` (MySQL must be running).
5. In Chrome, if page zoom changed previously, reset browser page zoom with **Ctrl+0** (once), then hard refresh with **Ctrl+Shift+R**.

## Manual checks

1. Visit Editor on LAN address `http://<lan-ip>:<vite-port>`: Library/Preview/Inspector should all remain visible at the normal viewport width.
2. Import a source video several minutes long and drag it onto a layer. The video should fit within the timeline, while the surrounding app dimensions **do not change**.
3. Use Ctrl+wheel over the Timeline toolbar/lanes; only the time scale should change.
4. Drag a clip toward a second clip **in the same layer**: dashed green gap guides, a matching free-time label, white/purple snap line, and red invalid collision ghost where applicable.
5. Drag the clip to another layer, trim either edge, and reload to confirm autosave.

## Validation limitations

TypeScript/TSX syntax and relative imports were checked locally. A full Vite/browser runtime test was not possible in the build environment because npm registry access was unavailable. Please run `npm run build` on the Windows installation and share any error output.
