import { GeminiBrandIcon } from './GeminiBrandIcon'
import { AudioLines, Captions, Film, GitBranch, Move3D, Scissors, Sparkles } from 'lucide-react'
import type { WorkflowNode } from './workflowTypes'

export const CONDS: WorkflowNode['when'][] = ['always', 'has_video', 'has_transcript', 'ai_enabled', 'condition_true', 'condition_false']
export const card = 'rounded-xl border border-[#e5e7eb] dark:border-[#374151] bg-white dark:bg-cl-dark-panel shadow-sm'
export const btn = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-[#e5e7eb] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-3 py-2 text-xs font-semibold text-[#374151] dark:text-[#f3f4f6] transition-colors hover:bg-[#f9fafb] dark:hover:bg-[#1f2937] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-45'
export const accent = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-[#f8fafc] dark:bg-[#171717] px-4 py-2 text-xs font-semibold text-gray-900 dark:text-white transition-colors hover:bg-[#f8fafc] dark:hover:bg-[#333] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-45'

export const accentFor = (type: string) =>
  type.startsWith('ai.') ? '#cb56a8' :
  type.startsWith('audio.') ? '#438be7' :
  type.startsWith('caption.') ? '#c68b35' :
  type.startsWith('video.') ? '#e26b6b' :
  type.startsWith('timeline.') ? '#35a788' :
  type.startsWith('animation.') ? '#8d65de' : '#7659c9'

export const toneFor = (type: string) =>
  type.startsWith('ai.') ? 'border-pink-300 bg-pink-50 text-pink-600' :
  type.startsWith('audio.') ? 'border-blue-300 dark:border-blue-900/70 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300' :
  type.startsWith('caption.') ? 'border-amber-300 dark:border-amber-900/70 bg-amber-50 dark:bg-amber-950/35 text-amber-700 dark:text-amber-300' :
  type.startsWith('video.') ? 'border-rose-300 dark:border-rose-900/70 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300' :
  type.startsWith('timeline.') ? 'border-emerald-300 dark:border-emerald-900/70 bg-emerald-50 dark:bg-emerald-950/35 text-emerald-700 dark:text-emerald-300' :
  type.startsWith('animation.') ? 'border-violet-300 dark:border-violet-900/70 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300' :
  'border-violet-300 dark:border-violet-900/70 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'

export const iconFor = (type: string, size = 15) => {
  if (/gemini/.test(type.toLowerCase())) return <GeminiBrandIcon size={size} />
  if (type.includes('transcribe')) return <AudioLines size={size} />
  if (type.includes('highlight') || type.includes('summary')) return <Sparkles size={size} />
  if (type.includes('caption')) return <Captions size={size} />
  if (type.includes('render')) return <Film size={size} />
  if (type.includes('cut')) return <Scissors size={size} />
  if (type.includes('animation')) return <Move3D size={size} />
  if (type.includes('audio')) return <AudioLines size={size} />
  if (type.includes('media') || type.includes('video')) return <Film size={size} />
  return <GitBranch size={size} />
}
