# CLIPTORA Timeline / Editor V2.4

**Base**: Cliptora V2.2.1. This patch does not touch Git, upload files, MySQL rows, or user configuration.

## Interface

- Resizable panels: drag the vertical handles between **Library / Preview / Clip Settings**. Drag the horizontal separator above the Timeline to resize its height. Double-click a handle to reset it; keyboard arrows are also supported. Panel sizes are remembered in the browser's local storage.
- Duplicated Audio entry removed from the left tools rail (use **Media → Sound**). Components now has one drag-and-drop Text item. Toolbar still offers quick Add Text.
- Right-click a **layer header** for Rename, Duplicate, Mute/Unmute, Hide/Show, Lock/Unlock, Background Color, Remove.
- Right-click a **timeline clip** for Rename, Duplicate, Cut, Split at playhead, Paste, Detach audio from video, Merge detached audio, Lock/Unlock, numeric settings via Inspector (timing, position, width, height, rotation, scale), video reverse preview, jump playhead to clip start/end, Remove.
- Preview: click a visible object to select it; **drag its body to move**; drag **bottom-right square to resize width/height**; drag **bottom-left cyan circle to scale proportionally**; drag **top white circle to rotate**. Drag changes persist with timeline autosave.
- Inspector: Name, Start, End, Duration, Source offset, X, Y, Width, Height, Rotation, Scale, Flip X/Y, Opacity, Text, Color, Audio Volume/Mute, reverse video frames in preview, Reset Transform.
- Timeline: previously implemented drag/drop between layers, automatic New Layer on drop, trim edges, zoom and auto-fit retained. Ctrl+X cuts a selected clip; Ctrl+V pastes at playhead if there is free space, Ctrl+Z / Ctrl+Y undo and redo.

## Important scope

- **Detach audio** uses the same uploaded video file as an audio-only browser playback layer and mutes its original video clip. **Merge** restores audio when detached audio has the same source and identical timing; it is a non-destructive editor operation, **not** a file mux/export.
- **Reverse** seeks video frames backward in browser preview with muted audio. Real-time reverse audio and FFmpeg export aren't implemented yet; that would require backend rendering support.
- Playback transforms (move, scale, rotate) appear in preview and persist in MySQL, but rendered-file export is not part of this version.
- Color chosen for a layer also becomes the canvas background used by the current preview if any visible layer has a non-default background color. A compositing-grade per-layer background render is a future extension.

## Existing installation on Windows

1. Stop the Vite/FastAPI console (Ctrl+C); keep MySQL from XAMPP running.
2. Extract `CLIPTORA_Editor_V2.4_Patch.zip` directly into `C:\xampp\htdocs\CLIPTORA` and overwrite matching source files. The ZIP uses `frontend/`, `backend/`, `scripts/` paths. Do not delete `.git`, `.env`, or media files.
3. Run the **one-time idempotent, additive** SQL schema update:

```powershell
cd C:\xampp\htdocs\CLIPTORA
powershell -ExecutionPolicy Bypass -File .\scripts\upgrade-v24.ps1
```

4. Run frontend tests and build:

```powershell
cd C:\xampp\htdocs\CLIPTORA\frontend
npm run test:timeline
npm run build
```

5. Start the app normally from the repo root:

```powershell
cd C:\xampp\htdocs\CLIPTORA
.\start-cliptora.bat
```

6. Refresh the browser with Ctrl+Shift+R. Right-click a layer header and a clip to see their menus.

`upgrade-v24.ps1` adds only `tracks.background_color`, `clips.properties_json`, and `clips.locked` when missing, and initializes null properties. It does **not** erase user rows. Do not run `scripts/install.ps1` again just for this patch. The patch never invokes Git or resets MySQL.

## Verification

Tested locally: Python syntax and schemas, API register/media/timeline saving and reading clip properties, editor-store operations for duplication, trim, split, detach/merge audio, cut, lock, positioning and undo/redo. TypeScript/TSX parsing and relative imports verified. Full Vite build and browser pointer interactions could not be fully executed in this environment due unavailable npm dependencies; **verify `npm run build` and drag/resize behavior on your Windows PC**.
