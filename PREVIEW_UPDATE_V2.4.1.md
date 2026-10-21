# CLIPTORA — Preview interaction v2.4.1

This update improves the existing V2.4 Preview **without changing the API schema, MySQL, Git or media files**.

## What changed

- A **visible selection toolbar** with Select, Move, Resize, Rotate and Scale modes. The selected object has a purple outline, an in-canvas label and distinct handles. Drag its body to manipulate it using the active tool, or use the handles (top-right rotate, bottom-right resize, bottom-left proportional scale, bottom-middle move).
- **Object picker** above the canvas lists currently visible objects from top to bottom. Use it to select an object behind another layer.
- If a selected visual clip does not intersect the playhead or its layer is hidden, **Go to clip** seeks into its time range (and reveals the hidden layer). Audio-only clips remain editable in Clip Settings.
- **Right-click an object in Preview** to open a menu: rename via Clip Settings, duplicate/cut/paste, lock/unlock, center, fit/reset, numeric size/position/rotation, rotate 90°, flip, timing, split, mute/detach video audio, reverse video preview and remove.
- **Right-click empty canvas** for Add text, Paste or Deselect.
- **Keyboard**: while the selected object has focus, Arrow keys nudge by 1% of canvas; Shift+Arrow nudges 5%; Escape clears selection.
- Preview resizes within its panel using a ResizeObserver. This does **not** alter Timeline zoom.
- Media playback is still synchronized to the editor playhead, with a functional preview mute button.
- Transform changes made by a single drag are saved as one editor operation, keeping Undo/Redo and autosave coherent.

## Files in targeted patch

- `frontend/src/components/editor/preview/PreviewPanel.tsx`
- `frontend/src/components/editor/preview/PreviewObject.tsx` (new)
- `frontend/src/components/editor/preview/previewGeometry.ts` (new)
- `frontend/tests/preview-geometry.test.cjs` (new)

## Install on Windows

Stop the running app (Ctrl+C), unpack **CLIPTORA_Preview_V2.4.1_Patch.zip** into `C:\xampp\htdocs\CLIPTORA` (overwrite the four patched files), then run:

```powershell
cd C:\xampp\htdocs\CLIPTORA\frontend
npm run typecheck
node --test tests\preview-geometry.test.cjs
npm run build
cd ..
.\start-cliptora.bat
```

Check `git status --short` before deciding what to commit. No automatic Git operations or backups.

## Scope and limits

This is an interactive Preview enhancement, **not a new FFmpeg renderer**. Video reversal is visual-only and muted, detach audio remains non-destructive until full export support is added. The Preview only draws visual clips active at the current time; selecting a non-active visual clip from Timeline shows the Go to clip shortcut instead of incorrectly drawing it over the current frame. The full production build/browser gestures must be verified in your Windows environment; the npm registry was unavailable in the packaging environment. Backend V2.4 schema fix is already included in the optional full-project archive, but is **not** required for this Preview-only patch.
