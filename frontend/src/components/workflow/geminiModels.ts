export type GeminiModelOption = { id: string; label: string; description: string }

export const GEMINI_TEXT_MODELS: GeminiModelOption[] = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', description: 'Current stable multimodal model for production text and reasoning workflows.' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', description: 'Previous stable Flash model for complex workflows.' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', description: 'Stable multimodal model balancing speed and quality.' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', description: 'Legacy Flash model for routine work.' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', description: 'Lower-cost model for lightweight, high-volume tasks.' },
]

export const GEMINI_IMAGE_MODELS: GeminiModelOption[] = [
  { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2', description: 'Recommended all-around Gemini image generation model.' },
  { id: 'gemini-3.1-flash-lite-image', label: 'Nano Banana 2 Lite', description: 'Fast, cost-efficient image generation.' },
  { id: 'gemini-3-pro-image', label: 'Nano Banana Pro', description: 'Professional asset production and complex image instructions.' },
  { id: 'gemini-2.5-flash-image', label: 'Nano Banana', description: 'Previous high-throughput image generation model.' },
]

export function modelsForGeminiAction(action: string): GeminiModelOption[] {
  return action === 'generate_image' ? GEMINI_IMAGE_MODELS : GEMINI_TEXT_MODELS
}

export function defaultModelForGeminiAction(action: string): string {
  return action === 'generate_image' ? 'gemini-3.1-flash-image' : 'gemini-3.8-flash'
}
