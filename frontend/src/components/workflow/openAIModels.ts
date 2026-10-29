export type OpenAIModelOption = { id: string; label: string; description: string }

export const OPENAI_TEXT_MODELS: OpenAIModelOption[] = [
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', description: 'Highest capability for difficult reasoning and agent work.' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', description: 'Strong default balance of intelligence and cost.' },
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', description: 'Fast visual reasoning and natural writing.' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', description: 'Fast, cost-efficient high-volume model.' },
  { id: 'gpt-5.5', label: 'GPT-5.5', description: 'Previous flagship model.' },
  { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Professional work and coding.' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: 'Smaller agent and coding model.' },
  { id: 'gpt-5.2', label: 'GPT-5.2', description: 'Previous generation reasoning model.' },
]

export const OPENAI_IMAGE_MODELS: OpenAIModelOption[] = [
  { id: 'gpt-image-2.5-sunburst', label: 'GPT-Image 2.5 Sunburst', description: 'Best image quality and editing precision.' },
  { id: 'gpt-image-2.5-flare', label: 'GPT-Image 2.5 Flare', description: 'Fast, high-quality image generation.' },
  { id: 'gpt-image-2', label: 'GPT-Image 2', description: 'Previous image generation model.' },
]

export const OPENAI_MODERATION_MODELS: OpenAIModelOption[] = [
  { id: 'omni-moderation-latest', label: 'Omni Moderation', description: 'Text and image safety classification.' },
]

export function modelsForOpenAIAction(action: string): OpenAIModelOption[] {
  if (action === 'classify_violations') return OPENAI_MODERATION_MODELS
  if (action === 'generate_image' || action === 'edit_image') return OPENAI_IMAGE_MODELS
  return OPENAI_TEXT_MODELS
}

export function defaultModelForOpenAIAction(action: string): string {
  if (action === 'classify_violations') return 'omni-moderation-latest'
  if (action === 'generate_image') return 'gpt-image-2.5-flare'
  if (action === 'edit_image') return 'gpt-image-2.5-sunburst'
  return 'gpt-6.1-sol'
}
