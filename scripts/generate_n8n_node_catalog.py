"""Generate CLIPTORA's read-only n8n node inventory from the vendored package.

This script never imports or executes n8n code. It reads the public package
manifest and emits discovery metadata only. Generated entries remain
unavailable until CLIPTORA has a tested executor and credential adapter.
"""
from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "vendor" / "n8n" / "packages" / "nodes-base" / "package.json"
OUTPUT = ROOT / "backend" / "app" / "workflows" / "registry" / "n8n_nodes.json"

FLOW_NODES = {"if", "switch", "merge", "splitinbatches", "wait", "stopanderror", "comparedata", "comparedatasets", "filter"}
DATA_NODES = {"aggregate", "code", "compression", "crypto", "dateandtime", "editimage", "itemlists", "limit", "movebinarydata", "removeduplicates", "renamekeys", "set", "sort", "splitout", "summarize", "xml"}
AI_MARKERS = ("openai", "mistral", "perplexity", "huggingface", "aitransform", "informationextractor", "sentimentanalysis", "textclassifier")


def words(value: str) -> str:
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", value)
    value = re.sub(r"[_-]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def slug(value: str) -> str:
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", value)
    return re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")


def category(path: str, base: str) -> str:
    folded = f"{path} {base}".casefold().replace("-", "").replace("_", "")
    if "trigger" in base.casefold():
        return "Triggers"
    if any(marker in folded for marker in AI_MARKERS):
        return "AI"
    normalized = re.sub(r"[^a-z0-9]", "", base.casefold())
    if normalized in FLOW_NODES:
        return "Flow"
    if normalized in DATA_NODES or "/transform/" in path.casefold():
        return "Data transformation"
    return "Action in an app"


def main() -> None:
    package = json.loads(PACKAGE.read_text(encoding="utf-8"))
    rows = []
    seen = set()
    for upstream_path in package["n8n"]["nodes"]:
        relative = upstream_path.removeprefix("dist/nodes/").removesuffix(".node.js")
        parts = relative.split("/")
        base = parts[-1]
        node_type = "n8n." + ".".join(slug(part) for part in parts)
        if node_type in seen:
            raise RuntimeError(f"Duplicate generated node type: {node_type}")
        seen.add(node_type)
        label = words(re.sub(r"V\d+$", "", base)).strip() or base
        rows.append({
            "type": node_type,
            "version": package["version"],
            "label": label,
            "group": category("/" + relative + "/", base),
            "description": f"n8n {label} node. Compatibility adapter is not installed.",
            "icon": slug(parts[0]),
            "settings": {},
            "status": "unavailable",
            "priority": "P1",
            "actions": [],
            "input_types": [],
            "output_types": [],
            "parameters_schema": {},
            "credentials": [],
            "backend_executor": None,
            "availability_reason": "Requires an audited n8n compatibility executor and native encrypted credentials.",
            "source_package": package["name"],
            "source_path": upstream_path,
            "source_license": package.get("license", "LicenseRef-n8n-sustainable-use"),
        })
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(rows)} n8n node definitions at {OUTPUT}")


if __name__ == "__main__":
    main()
