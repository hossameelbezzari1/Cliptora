# CLIPTORA — Tailwind CSS v4 integration

This adds Tailwind v4 to the existing React + TypeScript + Vite frontend without changing auth, Python/FastAPI, MySQL, Git history, or the Vite `/api/v1` CORS proxy.

## Apply on Windows

Place `CLIPTORA_EnableTailwind.ps1` in `C:\xampp\htdocs\CLIPTORA`.

```powershell
cd C:\xampp\htdocs\CLIPTORA
powershell -ExecutionPolicy Bypass -File .\CLIPTORA_EnableTailwind.ps1 -ProjectRoot . -DryRun
powershell -ExecutionPolicy Bypass -File .\CLIPTORA_EnableTailwind.ps1 -ProjectRoot . -RunChecks
cd frontend
npm run dev
```

## Files

- `frontend/vite.config.mjs`: adds `@tailwindcss/vite` while retaining existing config and proxy.
- `frontend/src/main.tsx`: imports `./tailwind.css` immediately after `./styles.css`.
- `frontend/src/tailwind.css`: imports Tailwind theme and utilities, defines Cliptora palette and typefaces.
- `frontend/package.json` and `frontend/package-lock.json`: updated by npm install.

## Why old CSS remains

This is a **safe Tailwind integration**, not a complete automatic conversion of the existing CSS classes. Tailwind Preflight reset is deliberately omitted to prevent existing controls, forms, and timeline visuals from unexpectedly changing. The existing component CSS remains active; new and gradually migrated React components can use Tailwind utilities. If old CSS classes conflict with a Tailwind utility, remove the old class from that component as part of its conversion.

## Sample new Tailwind classes

```tsx
<div className="rounded-2xl border border-cl-border bg-cl-panel p-4 text-white">
  <h2 className="font-cl-display text-lg font-bold">AI Scripts</h2>
  <button className="mt-4 rounded-xl bg-cl-purple px-4 py-2 font-semibold text-white hover:brightness-110">
    Create AI Script
  </button>
</div>
```

Full migration of `auth.css`, `dashboard.css`, `timeline.css`, `preview.css`, `workspace.css`, etc. into JSX utility classes should be handled component by component, with visual comparison against the original screenshot.

## Git

The script makes **no** backup files, commits, resets, cleans, or repository changes except normal working-tree source edits and npm-managed package manifests. Inspect changes with `git diff` and `git status --short`.
