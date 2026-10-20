# Cliptora engineering notes

Stack: React + TypeScript + Tailwind CSS v4 (Vite) and Python/FastAPI + MySQL. Use `src/components` for features and shared `src/components/ui`; avoid a `features/` directory. Never hard-code client LAN IPs/ports; Vite proxies relative `/api/v1` to configurable backend URL. Preserve provided dark editor layout as design reference. Work on the user's Git repo without automatic backups/reset/commits. AI script selections use *only* timestamped transcripts, not visual scene analysis. Distinguish implemented interactions from planned modules.
