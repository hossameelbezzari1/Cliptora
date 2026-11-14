"""Provider-independent AI Agent for the CLIPTORA Workflow Studio.

Discovered under its own family. Existing workflows retain the operation ID
`ai.agent`; the connected Chat Model chooses OpenAI, Gemini, or Ollama.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.workflows.Node import Node


class AIAgentNode(Node):
    family = "ai_agent"
    group = "AI Agents"
    icon = "lucide:bot"
    operations = {"ai.agent": {'icon': 'lucide:bot', 'label': 'AI Agent', 'settings': {'prompt_source': 'define_below', 'prompt': ''}, 'credentials': []}}
    parameter_fields = {
        "ai.agent": {
            "prompt_source": {"type": "string", "title": "Source for Prompt (User Message)", "options": [{"value": "connected_chat_trigger", "label": "Connected Chat Trigger Node"}, {"value": "define_below", "label": "Define below"}], "default": "define_below"},
            "prompt": {"type": "string", "title": "Prompt (User Message)", "widget": "textarea", "default": "", "description": "Use an expression to reference data in previous nodes or enter static text.", "visible_if": {"prompt_source": "define_below"}},
            "require_specific_output": {"type": "boolean", "title": "Require Specific Output Format", "default": False},
            "enable_fallback_model": {"type": "boolean", "title": "Enable Fallback Model", "default": False},
            "fallback_model": {"type": "string", "title": "Fallback Model"},
            "system_message": {"type": "string", "widget": "textarea", "title": "System Message", "group": "Advanced", "optional": True},
            "max_iterations": {"type": "integer", "title": "Max Iterations", "minimum": 1, "maximum": 30, "default": 10, "group": "Advanced", "optional": True, "default_visible": True},
            "return_intermediate_steps": {"type": "boolean", "title": "Return Intermediate Steps", "default": False, "group": "Advanced", "optional": True},
            "passthrough_binary_images": {"type": "boolean", "title": "Automatically Passthrough Binary Images", "default": False, "group": "Advanced", "optional": True},
            "passthrough_binary_pdfs": {"type": "boolean", "title": "Automatically Passthrough Binary PDFs", "default": False, "group": "Advanced", "optional": True},
            "auto_save_highlighted_data": {"type": "boolean", "title": "Auto-save highlighted data", "default": False, "group": "Advanced", "optional": True},
            "enable_streaming": {"type": "boolean", "title": "Enable Streaming", "default": False, "group": "Advanced", "optional": True},
            "batch_processing": {"type": "boolean", "title": "Batch Processing", "default": False, "group": "Advanced", "optional": True},
            "force_tool_call_first": {"type": "boolean", "title": "Force Tool Call on First Iteration", "default": False, "group": "Advanced", "optional": True},
            "tracing_metadata": {"type": "string", "title": "Tracing Metadata", "group": "Advanced", "optional": True},
            "generate_voiceovers_per_group": {"type": "boolean", "title": "Generate Voice-over for Every Video Group", "default": False},
            "voice_language": {"type": "string", "title": "Voice-over Language", "default": "Arabic"},
            "voice_preference": {"type": "string", "title": "Voice Preference", "enum": ["male", "female", "any"], "default": "male"},
            "browser_snapshot_chars": {"type": "integer", "title": "Browser Snapshot Characters", "minimum": 1000, "maximum": 16000, "default": 6500, "group": "Advanced", "optional": True},
            "allow_sensitive_actions": {"type": "boolean", "title": "Allow External/Destructive Actions", "default": False, "group": "Advanced", "optional": True},
        }
    }


    def execute_operation(self, operation, node, outputs, source, workdir):
        if operation != "ai.agent":
            raise ValueError(f"Unsupported AI Agent operation: {operation}")
        cfg = node.get("settings") or {}
        result = self.execute_ai_agent({
            **cfg,
            "_agent_tool_specs": node.get("_agent_tool_specs", {}),
            "_progress_callback": node.get("_progress_callback"),
            "_cancelled_callback": node.get("_cancelled_callback"),
            "_workdir": workdir,
        }, outputs)
        if isinstance(result, dict) and not bool(cfg.get("return_intermediate_steps", False)):
            agent = result.get("agent")
            if isinstance(agent, dict):
                agent.pop("steps", None)
        return result

    @staticmethod
    def _find_named_value(value: Any, name: str, depth: int=0) -> Any:
        """Find a bounded field in upstream JSON without evaluating expressions."""
        if depth > 8:
            return None
        if isinstance(value, dict):
            if name in value:
                return value[name]
            for nested in value.values():
                found = AIAgentNode._find_named_value(nested, name, depth + 1)
                if found is not None:
                    return found
        elif isinstance(value, list):
            for nested in value[:100]:
                found = AIAgentNode._find_named_value(nested, name, depth + 1)
                if found is not None:
                    return found
        return None

    @staticmethod
    def execute_ai_agent(cfg: dict[str, Any], outputs: dict[str, Any]) -> dict[str, Any]:
        raw_handles = cfg.get('__cliptora_ui_target_handles', {})
        handles = raw_handles if isinstance(raw_handles, dict) else {}
        model_ids = [source_id for source_id, handle in handles.items() if handle == 'chat_model' and source_id in outputs]
        if not model_ids:
            raise ValueError('AI Agent requires a Chat Model connection')
        model_output = outputs[model_ids[0]]
        model_cfg = model_output.get('chat_model', {}) if isinstance(model_output, dict) else {}
        if not isinstance(model_cfg, dict):
            raise ValueError('The connected Chat Model returned invalid configuration')
        prompt_source = str(cfg.get('prompt_source', 'define_below'))
        if prompt_source == 'connected_chat_trigger':
            prompt_value = AIAgentNode._find_named_value({key: value for key, value in outputs.items() if key not in model_ids}, 'chatInput')
            if prompt_value is None:
                raise ValueError('Connected Chat Trigger input is missing chatInput')
            prompt = str(prompt_value).strip()
        elif prompt_source == 'define_below':
            prompt = str(cfg.get('prompt', '')).strip()
        else:
            raise ValueError('AI Agent prompt source must be connected_chat_trigger or define_below')
        if not prompt:
            raise ValueError('AI Agent prompt cannot be empty')
        memory = {key: outputs[key] for key, handle in handles.items() if handle == 'memory' and key in outputs}
        tools = {key: outputs[key] for key, handle in handles.items() if handle == 'tool' and key in outputs}
        if memory:
            prompt += '\n\nConversation memory:\n' + json.dumps(memory, ensure_ascii=False, separators=(',', ':'))
        if tools:
            prompt += '\n\nConnected tool results:\n' + json.dumps(tools, ensure_ascii=False, separators=(',', ':'))
        request_cfg = {**model_cfg, 'prompt': prompt, 'system_prompt': str(cfg.get('system_message', 'You are a helpful AI agent.'))}
        provider = str(model_cfg.get('provider') or 'openai').lower()
        credential_id = model_cfg.get('credential_id')
        if provider not in ('openai', 'gemini', 'ollama'):
            raise ValueError('Connected Chat Model provider is unsupported')
        if type(credential_id) is not int or credential_id < 1:
            raise ValueError(f'Connect a {provider} credential in the Chat Model node')
        from app.workflows.Credentials import bind_for_node

        def invoke(selected_cfg: dict[str, Any]) -> dict[str, Any]:
            # Rebind to the connected model's credential rather than the Agent's.
            # The owner is inherited from the Workflow Engine's execution context.
            model_node = {'type': 'ai.chat_model', 'settings': {
                'provider': provider, 'credential_id': credential_id}}
            with bind_for_node(model_node):
                if provider == 'openai':
                    from app.workflows.nodes.OpenAI import OpenAINode
                    return OpenAINode.openai_chat(selected_cfg, {})
                if provider == 'gemini':
                    from app.workflows.nodes.Gemini import GeminiNode
                    return GeminiNode.message_model({'type': 'ai.gemini', 'settings': {
                        'model': selected_cfg['model'],
                        'prompt': selected_cfg['prompt'],
                        'system_prompt': selected_cfg['system_prompt'],
                        'output_mode': 'text'}}, {})
                from app.workflows.nodes.Ollama import OllamaNode
                return OllamaNode.ollama_action({
                    'action': 'message_model', 'model': selected_cfg['model'],
                    'prompt': selected_cfg['prompt'],
                    'system_prompt': selected_cfg['system_prompt']}, {})

        browser_specs = {
            key: spec for key, spec in (cfg.get('_agent_tool_specs') or {}).items()
            if spec.get('type') == 'browser.playwright'
        }
        if browser_specs:
            if len(browser_specs) != 1:
                raise ValueError('AI Agent currently supports one connected Playwright Browser tool')
            from app.workflows.AgentBrowserRuntime import run_browser_agent
            tool_id, spec = next(iter(browser_specs.items()))
            result = run_browser_agent(
                cfg=cfg,
                request_cfg=request_cfg,
                browser_node=spec,
                model_invoke=invoke,
                outputs=outputs,
                workdir=Path(cfg['_workdir']),
                progress=cfg.get('_progress_callback'),
                cancelled=cfg.get('_cancelled_callback'),
            )
            result.setdefault('agent', {}).update({
                'chat_model_node': model_ids[0],
                'memory_inputs': list(memory),
                'tool_inputs': list(tools),
                'browser_tool_node': tool_id,
            })
            return result

        try:
            result = invoke(request_cfg)
        except RuntimeError:
            fallback = str(cfg.get('fallback_model', '')).strip()
            if not cfg.get('enable_fallback_model') or not fallback:
                raise
            result = invoke({**request_cfg, 'model': fallback})
            result['fallback_used'] = True
        if cfg.get('require_specific_output'):
            try:
                result['structured_output'] = json.loads(str(result.get('text', '')))
            except ValueError as exc:
                raise ValueError('AI Agent required structured JSON output, but the model returned invalid JSON') from exc
        result['agent'] = {'chat_model_node': model_ids[0], 'memory_inputs': list(memory), 'tool_inputs': list(tools)}
        return result
