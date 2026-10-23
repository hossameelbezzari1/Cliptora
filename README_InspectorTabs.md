# CLIPTORA — Adaptive Clip Settings (right-side tabs)

This update is for the existing React Clip Settings panel. It does not modify the backend, MySQL, media files or your Git history.

## What changes

- Fixed vertical tabs on the far **right** of Clip Settings.
- Each selection exposes the relevant tabs:
  - **Image:** General, Transform, Media/Crop, Effects, Animations, Repeat, Commands, All settings.
  - **Video:** General, Transform, Media/Crop, Audio, Effects, Animations, Repeat, Commands, All settings.
  - **Audio:** General, Transform, Audio, Effects, Animations, Repeat, Commands, All settings.
  - **Text:** General, Transform, Text, Effects, Animations, Repeat, Commands, All settings.
  - **Shape:** General, Transform, Appearance, Effects, Animations, Repeat, Commands, All settings.
  - **Blur:** General, Transform, Blur, Effects, Animations, Repeat, Commands, All settings.
- Only the active tab is shown. Vertical rail and content scroll separately. Labels adapt to narrow inspector widths.
- Existing `InspectorPanel.tsx` is preserved as `CliptoraOriginalInspectorPanel` **inside the same file** and shown under **All settings**. This retains controls not yet categorized or whose field schemas vary between project revisions.
- Uses the existing `RepeatSettings.tsx` and `ClipCommandsSection.tsx` for those tabs.

## Installation (Windows)

Put `AdaptiveInspectorPanel.tsx` and `Install-AdaptiveInspector.py` together inside `C:\xampp\htdocs\CLIPTORA` (or elsewhere; they only need to be in the same folder).

```powershell
cd C:\xampp\htdocs\CLIPTORA
py .\Install-AdaptiveInspector.py --project-root . --dry-run
py .\Install-AdaptiveInspector.py --project-root . --apply
cd frontend
npm run typecheck
npm run build
```

The installer only recognizes an existing `export function InspectorPanel(...)` component at `frontend/src/components/editor/inspector/InspectorPanel.tsx`. If that signature is different, the installer stops without writing anything. In that case share your exact `InspectorPanel.tsx` for a precise patch.

**Prerequisite:** previously installed CLIPTORA V3.1 Commands integration and `RepeatSettings.tsx` exist at their expected locations.

## Important notes

- Adaptive tabs currently expose the common settings and current effect/animation stack summaries. Specialized settings specific to your project's exact shape/effect schema remain fully accessible in **All settings**.
- A new numeric property is created only when no supported existing alias is found. Verify whether your preview engine uses the same property keys. The exact live Inspector source was not available when this patch was authored.
- We ran a TSX syntax parse, a type-check against isolated compatibility stubs, and installer dry-run/apply/idempotence checks. We did **not** run a complete application build or verify behavior with your live `InspectorPanel.tsx`.
