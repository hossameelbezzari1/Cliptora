"""Registry-visible DTE nodes. The implementation stays in workflows/TypeAdapter.py."""
from app.workflows.TypeAdapter import TypeAdapterNode


class RegisteredTypeAdapterNode(TypeAdapterNode):
    """Expose data.inspect_type / convert_type / validate_type via discovery."""
    pass


