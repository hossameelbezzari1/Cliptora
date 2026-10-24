/** Small, dependency-free subtitle formats and project-local data model. */
export type SubtitleKind = 'draft' | 'manual' | 'imported' | 'auto' | 'template'
export type SubtitleCue = { id: string; start: number; end: number; text: string }
export type SubtitleStyle = {
  fontSize: number
  textColor: string
  backgroundColor: string
  position: 'bottom' | 'middle' | 'top'
  bold: boolean
  uppercase: boolean
}
export type SubtitleDoc = {
  id: string
  title: string
  language: string
  kind: SubtitleKind
  favorite: boolean
  tags: string[]
  mediaId: number | null
  createdAt: number
  updatedAt: number
  cues: SubtitleCue[]
  style: SubtitleStyle
}
export const DEFAULT_STYLE: SubtitleStyle = {
  fontSize: 24,
  textColor: '#ffffff',
  backgroundColor: '#000000',
  position: 'bottom',
  bold: true,
  uppercase: false,
}
export const subtitleId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
export const toSeconds = (value: string): number | null => {
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/)
  if (!match) return null
  const hours = Number(match[1] || 0)
  const mins = Number(match[2])
  const seconds = Number(match[3])
  if (mins > 59 || seconds > 59) return null
  return hours * 3600 + mins * 60 + seconds + Number(match[4].padEnd(3, '0')) / 1000
}
export const timestamp = (value: number, separator: ',' | '.' = ',') => {
  const ms = Math.max(0, Math.round(value * 1000))
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor(ms % 3_600_000 / 60_000)
  const seconds = Math.floor(ms % 60_000 / 1000)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(ms % 1000).padStart(3, '0')}`
}
export const shortTime = (value: number) => {
  const whole = Math.max(0, Math.floor(value))
  const hours = Math.floor(whole / 3600)
  const mins = Math.floor(whole % 3600 / 60)
  const secs = whole % 60
  return hours ? `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}
/** Supports SRT, WebVTT, cue settings after the ending timestamp, and multiline captions. */
export function parseSubtitleText(content: string): SubtitleCue[] {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  const blocks = normalized.replace(/^WEBVTT[^\n]*\n(?:[^\n]*\n)*?\n/, '').split(/\n\s*\n/)
  const cues: SubtitleCue[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    if (!lines.length || lines[0].startsWith('NOTE') || lines[0].startsWith('STYLE') || lines[0].startsWith('REGION')) continue
    const timingIndex = lines.findIndex(line => line.includes('-->'))
    if (timingIndex < 0) continue
    const parts = lines[timingIndex].split('-->')
    const start = toSeconds(parts[0] ?? '')
    const end = toSeconds((parts[1] ?? '').trim().split(/\s+/)[0])
    const text = lines.slice(timingIndex + 1).join('\n').trim()
    if (start === null || end === null || end <= start || !text) continue
    cues.push({ id: subtitleId(), start, end, text })
  }
  if (cues.length === 0) throw new Error('No valid subtitles found. Import a .srt or .vtt file with timestamps.')
  return cues.sort((a, b) => a.start - b.start)
}
export function exportSubtitles(doc: SubtitleDoc, format: 'srt' | 'vtt' | 'json'): string {
  if (format === 'json') return JSON.stringify(doc, null, 2)
  const ordered = [...doc.cues].filter(cue => cue.text.trim() && cue.end > cue.start).sort((a, b) => a.start - b.start)
  const body = ordered.map((cue, i) => `${format === 'srt' ? `${i + 1}\n` : ''}${timestamp(cue.start, format === 'srt' ? ',' : '.')} --> ${timestamp(cue.end, format === 'srt' ? ',' : '.')}\n${cue.text.trim()}`).join('\n\n')
  return format === 'vtt' ? `WEBVTT\n\n${body}\n` : `${body}\n`
}
export function saveSubtitleDownload(doc: SubtitleDoc, format: 'srt' | 'vtt' | 'json'): void {
  const mime = format === 'json' ? 'application/json' : format === 'vtt' ? 'text/vtt' : 'application/x-subrip'
  const blob = new Blob([exportSubtitles(doc, format)], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${doc.title.trim().replace(/[^\w\-.]+/g, '_') || 'subtitles'}.${format}`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function makeSubtitleDoc(title = 'Untitled subtitles', kind: SubtitleKind = 'manual', cues: SubtitleCue[] = []): SubtitleDoc {
  const now = Date.now()
  return {
    id: subtitleId(), title, kind, language: 'English', favorite: false, tags: [], mediaId: null,
    createdAt: now, updatedAt: now, cues,
    style: { ...DEFAULT_STYLE },
  }
}
const validCue = (cue: unknown): cue is SubtitleCue => {
  if (!cue || typeof cue !== 'object') return false
  const c = cue as Partial<SubtitleCue>
  return typeof c.id === 'string' && typeof c.start === 'number' && Number.isFinite(c.start) &&
    typeof c.end === 'number' && Number.isFinite(c.end) && typeof c.text === 'string'
}
export function loadSubtitles(projectId: string): SubtitleDoc[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(`cliptora.subtitles.v1.${projectId}`) ?? '[]')
    if (!Array.isArray(data)) return []
    return data.flatMap((item: unknown) => {
      if (!item || typeof item !== 'object') return []
      const doc = item as Partial<SubtitleDoc>
      if (typeof doc.id !== 'string' || typeof doc.title !== 'string' || !Array.isArray(doc.cues)) return []
      return [{
        ...makeSubtitleDoc(doc.title), ...doc,
        cues: doc.cues.filter(validCue),
        tags: Array.isArray(doc.tags) ? doc.tags.filter((tag): tag is string => typeof tag === 'string') : [],
        style: { ...DEFAULT_STYLE, ...(doc.style ?? {}) },
      } as SubtitleDoc]
    })
  } catch { return [] }
}
