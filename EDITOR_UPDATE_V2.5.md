# CLIPTORA V2.5.0 — Compact Preview + Scroll + Crop / Cut

This ZIP is a patch for the *existing* CLIPTORA V2.4.1 project. It is not a clean installation.

## Changes
- Preview tools (Select, Move, Resize, Rotate, Scale), object picker and project resolution now appear in the **global editor header**. The separate preview header and extra status row were removed, leaving more room for video.
- Preview playback controls include **Cut** (split selected clip at the current playhead); Cut is disabled at invalid boundaries and on locked clips.
- Timeline now includes visible **horizontal pan slider** and left/right arrows, vertical layer scrolling with up/down arrows and wheel, Shift+wheel for horizontal pan, zoom and Fit remain independent from the rest of the page.
- **Crop** button in Timeline (and editor header) activates spatial crop for a selected image or video. Green handles in Preview crop the *left/right/top/bottom* source edges. Inspector has four numeric crop fields and Reset crop. Crop values are saved non-destructively in clip JSON properties.
- Crop can be activated from the Preview/Timeline right-click menus. If playhead is outside the selected clip, crop action jumps into the clip automatically.

Crop is a spatial mask on the preview, **not** a change to a clip's duration. Drag the clip's edge in Timeline to trim its duration. Cropped output is not yet rendered/exported because FFmpeg export is still a future feature. Existing files are not destructively modified.

## Update current project (Windows PowerShell)
1. Stop the existing frontend and backend (Ctrl+C / close start-cliptora.bat console). Keep MySQL running.
2. Download `CLIPTORA_Editor_V2.5_Patch.zip` to Downloads.
3. Run:

```powershell
cd C:\xampp\htdocs\CLIPTORA
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\CLIPTORA_Editor_V2.5_Patch.zip" -DestinationPath . -Force
git status --short
cd frontend
npm run typecheck
npm run build
cd ..
.\start-cliptora.bat
```

Refresh the browser using Ctrl+Shift+R.

Backend schema file is included because it validates crop values before save. **Restart Python**; no database table alteration or migration is required. The existing MySQL `clips.properties_json` column stores the crop fields.

The patch does not include or change `.git`, `.env`, uploaded media or database files. No auto-commit/reset/clean or backup file is made.

## Checks performed in the preparation environment
- TypeScript/TSX parsing and relative import paths checked.
- Frontend timeline store tests passed.
- Frontend preview geometry tests passed, including crop boundaries.
- FastAPI/Pydantic schema tests passed.
- FastAPI integration smoke tests using an isolated SQLite test DB passed including crop persistence.
- A full `npm run build` and live browser pointer/scroll check **could not** be run in the preparation environment (npm packages not available locally). Run the above typecheck/build on your Windows installation.
