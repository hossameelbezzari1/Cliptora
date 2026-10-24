import { fileUrl } from '../../../lib/api'
import type { MediaAsset } from '../../../types'

const raw = (media: MediaAsset): Record<string, unknown> => media as unknown as Record<string, unknown>

export function mediaName(media: MediaAsset): string {
  const r = raw(media)
  for (const key of ['original_filename', 'original_name', 'filename', 'file_name', 'name', 'title']) {
    const value = r[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return `Media ${media.id}`
}

export function mediaSource(media: MediaAsset): string { return fileUrl(media.id) }
export function mediaDuration(media: MediaAsset): number | null {
  const r = raw(media)
  for (const key of ['duration', 'duration_seconds']) {
    const v = r[key]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  }
  return null
}
export function mediaDimensions(media: MediaAsset): string {
  const r = raw(media)
  const width = typeof r.width === 'number' ? r.width : null
  const height = typeof r.height === 'number' ? r.height : null
  return width && height ? `${width} × ${height}` : '—'
}
export function mediaSizeBytes(media: MediaAsset): number | null {
  const r = raw(media)
  for (const key of ['size_bytes', 'file_size', 'size']) {
    const value = r[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return null
}
export function mediaSize(media: MediaAsset): string {
  const bytes = mediaSizeBytes(media)
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}
export function mediaDate(media: MediaAsset): string {
  const r = raw(media)
  const value = r.created_at ?? r.uploaded_at ?? r.createdAt
  if (typeof value !== 'string' && typeof value !== 'number') return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}
export function mediaTime(media: MediaAsset): number {
  const r = raw(media)
  const value = r.created_at ?? r.uploaded_at ?? r.createdAt
  if (typeof value !== 'string' && typeof value !== 'number') return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}
export function mediaFormat(media: MediaAsset): string {
  const r = raw(media)
  const mime = r.mime_type ?? r.content_type
  if (typeof mime === 'string' && mime) return mime
  const filename = mediaName(media)
  return filename.includes('.') ? filename.split('.').pop()?.toUpperCase() ?? '—' : '—'
}
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const whole = Math.floor(seconds)
  const hh = Math.floor(whole / 3600)
  const mm = Math.floor(whole % 3600 / 60)
  const ss = whole % 60
  return hh ? `${hh}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}` : `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
}
