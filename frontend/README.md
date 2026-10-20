# Cliptora Frontend

React 19 + TypeScript + Vite 6 + Tailwind CSS v4 + Zustand. No `features/` directory: reusable UI and editor functionality lives under `src/components`.

Install: `npm install`, then `npm run dev`. `npm run build` runs TypeScript checks and Vite build.

The Vite development server binds `0.0.0.0` and chooses an available port. The frontend always calls relative `/api/v1/...` endpoints, routed through the Vite proxy to `BACKEND_URL` in `.env` (defaults to `http://127.0.0.1:8000`). Links on the LAN therefore use whatever URL Vite prints; they do not require hard-coded IPs or ports.

Backend API must be running for Login, Projects, Media and Timeline.
