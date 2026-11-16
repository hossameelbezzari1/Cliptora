"""Export the live CLIPTORA Python node contracts to TypeScript.

Run from backend/: python scripts/export_workflow_types.py
No new Node types or schema names are hardcoded in this script.
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
PROJECT = BACKEND.parent
sys.path.insert(0, str(BACKEND))

from app.workflows.TypeRegistry import typescript_catalog  # noqa: E402


def main() -> None:
    target = PROJECT / "frontend" / "src" / "components" / "workflow" / "types" / "generatedNodeContracts.ts"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(typescript_catalog(), encoding="utf-8")
    print(f"Exported live workflow node type catalog: {target}")


if __name__ == "__main__":
    main()


