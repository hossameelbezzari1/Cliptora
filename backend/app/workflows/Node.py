
"""CLIPTORA node contract: implementations and metadata live in Python node classes."""
from __future__ import annotations

from abc import ABC, abstractmethod
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, ClassVar

NodeHandler = Callable[
    [dict[str, Any], dict[str, Any], Path | None, Path],
    dict[str, Any],
]


@dataclass(frozen=True)
class NodeDefinition:
    type: str
    metadata: Callable[[], dict[str, Any]]
    execute: NodeHandler


class Node(ABC):
    family: ClassVar[str]
    group: ClassVar[str]
    icon: ClassVar[str] = "lucide:workflow"
    operations: ClassVar[dict[str, dict[str, Any]]] = {}
    parameter_fields: ClassVar[
        dict[str, dict[str, dict[str, Any]]]
    ] = {}
    action_fields: ClassVar[
        dict[str, dict[str, dict[str, dict[str, Any]]]]
    ] = {}

    @abstractmethod
    def execute_operation(
        self,
        operation: str,
        node: dict[str, Any],
        outputs: dict[str, Any],
        source: Path | None,
        workdir: Path,
    ) -> dict[str, Any]:
        """Execute the operation and return a JSON object."""

    def execute(
        self,
        operation: str,
        node: dict[str, Any],
        outputs: dict[str, Any],
        source: Path | None,
        workdir: Path,
    ) -> dict[str, Any]:
        if operation not in self.operations:
            raise ValueError(
                f"Unknown {self.family} operation: {operation}"
            )

        # Legacy nodes behave exactly as before. Typed validation is opt-in.
        # Contracts are structural: new node families can declare schemas without
        # changing the engine or registering hardcoded Python types.
        cfg = node.get("settings") or {}
        type_mode = cfg.get("type_validation_mode", "legacy")
        if type_mode not in ("legacy", "strict", "adapt", "auto"):
            raise ValueError("Type Validation Mode must be legacy, strict, adapt, or auto")

        if type_mode == "strict":
            from .TypeEngine import TypeContractError, validate_value
            from .InputResolver import resolve_input_path

            input_schema = (
                cfg.get("type_input_schema")
                or self.operations[operation].get("input_contract")
                or {}
            )
            input_path = str(cfg.get("type_input_path") or "").strip()

            if input_schema:
                if not input_path:
                    raise TypeContractError(
                        "Strict input validation requires Type Input Path"
                    )
                selected = resolve_input_path(outputs, input_path)
                issues = validate_value(selected, input_schema)["errors"]
                if issues:
                    raise TypeContractError(
                        "Input contract failed: " + "; ".join(issues[:5])
                    )

        # DTE V2 is ADDITIVE: the original Strict checks above are retained.
        # The bridge only supplies a private transformed view for Adapt/Auto;
        # legacy and strict operations keep the original upstream objects.
        data_view = outputs
        if type_mode in ("strict", "adapt", "auto"):
            from .TypeRuntime import prepare_typed_inputs

            data_view, _type_adaptation = prepare_typed_inputs(
                cfg,
                self.operations[operation],
                outputs,
                node.get("depends_on") or [],
            )

        result = self.execute_operation(
            operation, node, data_view, source, workdir
        )

        if not isinstance(result, dict):
            raise TypeError(
                f"Node operation {operation} must return a JSON object"
            )

        if type_mode in ("strict", "adapt", "auto"):
            from .TypeEngine import TypeContractError, validate_value

            output_schema = (
                cfg.get("type_output_schema")
                or self.operations[operation].get("output_contract")
                or {}
            )
            if output_schema:
                issues = validate_value(result, output_schema)["errors"]
                if issues:
                    raise TypeContractError(
                        "Output contract failed: " + "; ".join(issues[:5])
                    )

        return result

    @classmethod
    def definition(cls, operation: str) -> NodeDefinition:
        if operation not in cls.operations:
            raise ValueError(
                f"Unknown operation: {operation}"
            )

        def metadata() -> dict[str, Any]:
            from .Schemas import inferred_parameters_schema

            meta = deepcopy(cls.operations[operation])

            if not operation.endswith("trigger") and operation not in {
                "ai.chat_model", "ai.window_memory"
            }:
                meta["settings"] = {
                    **(meta.get("settings") or {}),
                    "execution_mode": "once",
                    "execution_input_path": "",
                    "execution_input_shape": "item",
                    "execution_batch_size": 10,
                    "execution_parallelism": 1,
                    "execution_max_items": 500,
                    "execution_flatten": False,
                    "execution_error_policy": "stop",
                    "execution_empty_policy": "stop",
                    "type_validation_mode": "legacy",
                    "type_input_path": "",
                    "type_target_path": "",
                    "type_adapter_rule": {},
                    "type_source_schema": {},
                    "type_input_schema": {},
                    "type_output_schema": {},
                }

            ui = inferred_parameters_schema(meta.get("settings") or {})

            if "execution_mode" in meta["settings"]:
                ui["properties"].update({
                    "execution_mode": {
                        "type": "string",
                        "title": "Execution Mode",
                        "enum": ["once", "for_each", "batch"],
                        "default": "once",
                        "group": "Execution",
                        "description": (
                            "Run once, separately for each element, or on batches."
                        ),
                    },
                    "execution_input_path": {
                        "type": "string",
                        "title": "Input Collection",
                        "widget": "upstream",
                        "accepts": ["json"],
                        "group": "Execution",
                        "description": (
                            "Connected source array, e.g. transcription.words or split.clips."
                        ),
                    },
                    "execution_input_shape": {
                        "type": "string",
                        "title": "Input Shape",
                        "enum": ["item", "collection"],
                        "default": "item",
                        "group": "Execution",
                        "description": (
                            "Pass the current item, or preserve original JSON "
                            "with a one-item collection."
                        ),
                    },
                    "execution_parallelism": {
                        "type": "integer",
                        "title": "Parallel Workers",
                        "minimum": 1,
                        "maximum": 4,
                        "group": "Execution",
                        "description": (
                            "1 = sequential. Parallel requires a supported, "
                            "independent operation."
                        ),
                    },
                    "execution_batch_size": {
                        "type": "integer",
                        "title": "Batch Size",
                        "minimum": 1,
                        "maximum": 200,
                        "group": "Execution",
                        "visible_if": {"execution_mode": "batch"},
                    },
                    "execution_max_items": {
                        "type": "integer",
                        "title": "Maximum Input Items",
                        "minimum": 1,
                        "maximum": 2000,
                        "group": "Execution",
                    },
                    "execution_flatten": {
                        "type": "boolean",
                        "title": "Flatten Nested Arrays",
                        "group": "Execution",
                    },
                    "execution_error_policy": {
                        "type": "string",
                        "title": "On Item Error",
                        "enum": ["stop", "continue"],
                        "group": "Execution",
                    },
                    "execution_empty_policy": {
                        "type": "string",
                        "title": "When Collection Is Empty",
                        "enum": ["stop", "empty"],
                        "group": "Execution",
                    },
                })

            if "type_validation_mode" in meta["settings"]:
                ui["properties"].update({
                    "type_validation_mode": {
                        "type": "string",
                        "title": "Type Validation Mode",
                        "enum": ["legacy", "strict", "adapt", "auto"],
                        "group": "Type System",
                        "description": (
                            "Legacy keeps current behavior. Strict checks "
                            "declared input/output schemas."
                        ),
                    },
                    "type_input_path": {
                        "type": "string",
                        "title": "Type Input Path",
                        "widget": "upstream",
                        "accepts": ["json"],
                        "group": "Type System",
                    },
                    "type_target_path": {
                        "type": "string",
                        "title": "Adapted Target Path",
                        "widget": "upstream",
                        "accepts": ["json"],
                        "group": "Type System",
                        "description": "Where to inject adapted data into the local input view.",
                    },
                    "type_adapter_rule": {
                        "type": "object",
                        "title": "Approved Versioned Adapter Rule",
                        "group": "Type System",
                        "description": "Only explicit approved mappings and unit conversions are used.",
                    },
                    "type_source_schema": {
                        "type": "object",
                        "title": "Source Semantic Contract",
                        "group": "Type System",
                    },
                    "type_input_schema": {
                        "type": "object",
                        "title": "Expected Input JSON Schema",
                        "group": "Type System",
                    },
                    "type_output_schema": {
                        "type": "object",
                        "title": "Expected Output JSON Schema",
                        "group": "Type System",
                    },
                })

            ui["properties"].update(
                deepcopy(cls.parameter_fields.get(operation, {}))
            )

            inputs = deepcopy(meta.get("inputs", []))

            if not isinstance(inputs, list):
                raise TypeError(
                    f"Node {operation}: inputs must be a list"
                )

            for item in inputs:
                if (
                    not isinstance(item, dict)
                    or not item.get("name")
                    or not item.get("type")
                ):
                    raise TypeError(
                        f"Node {operation}: invalid input definition"
                    )

            return {
                "label": meta["label"],
                "group": cls.group,
                "family": cls.family,
                "settings": meta.get("settings", {}),
                "icon": meta.get("icon", cls.icon),
                "family_icon": cls.icon,
                "operation_icon": meta.get("icon", cls.icon),
                "credentials": meta.get("credentials", []),
                "actions": meta.get("actions", []),
                "inputs": inputs,
                "input_types": meta.get("input_types", []),
                "output_types": meta.get("output_types", ["json"]),
                "input_contract": deepcopy(meta.get("input_contract") or {}),
                "output_contract": deepcopy(meta.get("output_contract") or {}),
                "type_system": {
                    "version": 2,
                    "discovery": True,
                    "mapping": True,
                    "runtime_validation": True,
                },
                "parameters_schema": ui,
                "action_parameters": deepcopy(
                    cls.action_fields.get(operation, {})
                ),
                "source_picker": bool(
                    meta.get("source_picker", False)
                ),
            }

        def execute(
            node: dict[str, Any],
            outputs: dict[str, Any],
            source: Path | None,
            workdir: Path,
        ) -> dict[str, Any]:
            return cls().execute(
                operation, node, outputs, source, workdir
            )

        return NodeDefinition(
            type=operation,
            metadata=metadata,
            execute=execute,
        )


BaseNode = Node
