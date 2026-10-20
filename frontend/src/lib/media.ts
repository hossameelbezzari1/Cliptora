import type { MediaAsset } from '../types'
import { fileUrl } from './api'

const cache = new Map<number, Promise<{ duration: number; measured: boolean }>>()

export function probeMediaDuration(media: MediaAsset): Promise<{ duration: number; measured: boolean }> {
  if (media.kind === 'image') return Promise.resolve({ duration: 5, measured: true })
  const existing = cache.get(media.id)
  if (existing) return existing
  const promise = new Promise<{ duration: number; measured: boolean }>(resolve => {
    const el = document.createElement(media.kind === 'audio' ? 'audio' : 'video')
    let finished = false
    const timeout = window.setTimeout(() => complete(8, false), 4500)
    function complete(value: number, measured: boolean) {
      if (finished) return
      finished = true
      window.clearTimeout(timeout)
      el.removeAttribute('src')
      el.load()
      resolve({ duration: Number.isFinite(value) && value > 0 ? Math.min(value, 14400) : 8, measured })
    }
    el.preload = 'metadata'
    el.onloadedmetadata = () => complete(el.duration, Number.isFinite(el.duration) && el.duration > 0)
    el.onerror = () => complete(8, false)
    el.src = fileUrl(media.id)
  })
  cache.set(media.id, promise)
  return promise
}
