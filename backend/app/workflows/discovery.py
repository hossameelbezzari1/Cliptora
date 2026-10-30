"""Public discovery interface for startup checks and plugin installation."""
from .registry import discovered, node_metadata

def validate_node_registry() -> list[str]:
    return sorted(node_metadata())
