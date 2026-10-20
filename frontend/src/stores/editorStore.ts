import { create } from 'zustand'
import type { Track, Clip, MediaAsset, Timeline } from '../types'
import { uid } from '../lib/api'

export type DragItem =
  | { kind: 'clip'; clipId: string; offset: number; duration: number }
  | { kind: 'media'; mediaId: number; duration: number }
  | { kind: 'text'; duration: number }

export const MIN_CLIP = 0.1
export const MAX_TIME = 14400
export const MAX_LAYERS = 100
const EPS = 0.0001
const roundTime = (value: number) => Math.round(value * 100) / 100
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const layer = (name: string, position: number): Track => ({ client_id: uid(), name, type: 'mixed', position, hidden: false, muted: false, locked: false, clips: [] })
const normalize = (tracks: Track[]) => tracks.map((track, position) => ({ ...track, position }))
export const defaultLayers = (): Track[] => [layer('Layer 1', 0), layer('Layer 2', 1), layer('Layer 3', 2)]
const nextLayerName = (tracks: Track[]) => {
  const used = new Set(tracks.map(track => track.name.toLowerCase()))
  let number = 1
  while (used.has(`layer ${number}`)) number++
  return `Layer ${number}`
}
export const canPlace = (track: Track, start: number, duration: number, except?: string) =>
  !track.locked && Number.isFinite(start) && Number.isFinite(duration) && start >= 0 &&
  duration >= MIN_CLIP - EPS && start + duration <= MAX_TIME + EPS &&
  !track.clips.some(c => c.client_id !== except && start < c.start + c.duration - EPS && start + duration > c.start + EPS)

export function snapTime(value: number, tracks: Track[], playhead: number, pxPerSecond: number, except?: string) {
  const threshold = Math.min(1.5, 9 / pxPerSecond)
  const candidates = [0, playhead, ...tracks.flatMap(t => t.clips.filter(c => c.client_id !== except).flatMap(c => [c.start, c.start + c.duration]))]
  let closest = value
  let distance = threshold
  for (const candidate of candidates) {
    const gap = Math.abs(candidate - value)
    if (gap < distance) { closest = candidate; distance = gap }
  }
  return roundTime(Math.max(0, closest))
}

type Store = {
  projectId: number | null; revision: number; tracks: Track[]; media: MediaAsset[]; mediaDurations: Record<number, number>
  playhead: number; playing: boolean; selectedClipId: string | null; selectedTrackId: string | null
  dragging: DragItem | null; dirty: number; past: Track[][]; future: Track[][]
  hydrate: (projectId: number, timeline: Timeline) => void
  setMedia: (media: MediaAsset[]) => void; setMediaDuration: (id: number, seconds: number) => void
  setPlayhead: (seconds: number) => void; setPlaying: (yes: boolean) => void
  selectClip: (id: string | null) => void; selectTrack: (id: string | null) => void
  startDrag: (item: DragItem | null) => void
  changeTracks: (fn: (tracks: Track[]) => Track[]) => void
  addTrack: () => void; renameTrack: (id: string, name: string) => void
  toggleTrack: (id: string, key: 'hidden' | 'muted' | 'locked') => void; removeTrack: (id: string) => void
  addMediaClip: (media: MediaAsset, duration: number) => void
  addMediaClipAt: (media: MediaAsset, duration: number, targetId: string | null, start: number) => boolean
  addTextClip: () => void; addTextClipAt: (targetId: string | null, start: number) => boolean
  moveClip: (clipId: string, targetId: string | null, start: number) => boolean
  trimClip: (clipId: string, edge: 'left' | 'right', delta: number, pixelsPerSecond: number) => boolean
  patchClip: (id: string, patch: Partial<Clip>) => void; removeClip: (id: string) => void
  undo: () => void; redo: () => void; markSaved: (revision: number) => void
}

export const useEditor = create<Store>((set, get) => ({
  projectId: null, revision: 1, tracks: [], media: [], mediaDurations: {}, playhead: 0, playing: false,
  selectedClipId: null, selectedTrackId: null, dragging: null, dirty: 0, past: [], future: [],
  hydrate: (projectId, timeline) => {
    const missing = timeline.tracks.length === 0
    const tracks = missing ? defaultLayers() : normalize(timeline.tracks)
    set({ projectId, revision: timeline.revision, tracks, playhead: 0, playing: false, selectedClipId: null,
      selectedTrackId: tracks[tracks.length - 1]?.client_id ?? null, dragging: null, dirty: missing ? 1 : 0,
      mediaDurations: {}, past: [], future: [] })
  },
  setMedia: media => set({ media }),
  setMediaDuration: (id, seconds) => { if (Number.isFinite(seconds) && seconds > 0) set(s => ({ mediaDurations: { ...s.mediaDurations, [id]: seconds } })) },
  setPlayhead: playhead => set({ playhead: clamp(playhead, 0, MAX_TIME) }),
  setPlaying: playing => set({ playing }),
  selectClip: selectedClipId => set({ selectedClipId }),
  selectTrack: selectedTrackId => set({ selectedTrackId }),
  startDrag: dragging => set({ dragging }),
  changeTracks: fn => set(s => {
    const updated = fn(s.tracks)
    if (updated === s.tracks) return s
    return { tracks: normalize(updated), past: [...s.past.slice(-49), structuredClone(s.tracks)], future: [], dirty: s.dirty + 1 }
  }),
  addTrack: () => get().changeTracks(ts => ts.length < MAX_LAYERS ? [...ts, layer(nextLayerName(ts), ts.length)] : ts),
  renameTrack: (id, name) => {
    const clean = name.trim().slice(0, 100)
    if (!clean) return
    get().changeTracks(ts => ts.map(t => t.client_id === id && t.name !== clean ? { ...t, name: clean } : t))
  },
  toggleTrack: (id, key) => get().changeTracks(ts => ts.map(t => t.client_id === id ? { ...t, [key]: !t[key] } : t)),
  removeTrack: id => {
    get().changeTracks(ts => ts.filter(t => t.client_id !== id))
    set({ selectedTrackId: null, selectedClipId: null })
  },
  addMediaClip: (media, duration) => {
    const state = get()
    const preferred = state.tracks.find(t => t.client_id === state.selectedTrackId && !t.locked) ?? [...state.tracks].reverse().find(t => !t.locked)
    if (!preferred) return
    const atEnd = Math.max(0, ...preferred.clips.map(c => c.start + c.duration))
    get().addMediaClipAt(media, duration, preferred.client_id, atEnd)
  },
  addMediaClipAt: (media, seconds, targetId, start) => {
    const state = get()
    const duration = roundTime(clamp(seconds, MIN_CLIP, MAX_TIME))
    const source = state.mediaDurations[media.id]
    const safeDuration = source ? Math.min(duration, source) : duration
    const target = state.tracks.find(t => t.client_id === targetId)
    if (targetId && !target) return false
    if (!target && state.tracks.length >= MAX_LAYERS) return false
    if (!canPlace(target ?? layer('Temp', 0), start, safeDuration)) return false
    const clientId = uid()
    const clip: Clip = { client_id: clientId, name: media.name.slice(0, 160), type: media.kind, media_id: media.id,
      start: roundTime(start), duration: roundTime(safeDuration), source_offset: 0, text: null, color: '#5bff93' }
    let destinationId = targetId
    get().changeTracks(ts => {
      if (!destinationId) {
        const fresh = layer(nextLayerName(ts), 0)
        destinationId = fresh.client_id
        return [{ ...fresh, clips: [clip] }, ...ts]
      }
      return ts.map(t => t.client_id === destinationId ? { ...t, clips: [...t.clips, clip] } : t)
    })
    set({ selectedClipId: clientId, selectedTrackId: destinationId, playhead: start })
    return true
  },
  addTextClip: () => {
    const state = get()
    const track = state.tracks.find(t => t.client_id === state.selectedTrackId && !t.locked) ?? [...state.tracks].reverse().find(t => !t.locked)
    if (!track) return
    const at = canPlace(track, state.playhead, 5) ? state.playhead : Math.max(0, ...track.clips.map(c => c.start + c.duration))
    get().addTextClipAt(track.client_id, at)
  },
  addTextClipAt: (targetId, start) => {
    const state = get()
    const target = state.tracks.find(t => t.client_id === targetId)
    if (targetId && !target) return false
    if (!target && state.tracks.length >= MAX_LAYERS) return false
    if (!canPlace(target ?? layer('Temp', 0), start, 5)) return false
    const clip: Clip = { client_id: uid(), name: 'New text', type: 'text', media_id: null,
      start: roundTime(start), duration: 5, source_offset: 0, text: 'Your text here', color: '#5bff93' }
    let destinationId = targetId
    get().changeTracks(ts => {
      if (!destinationId) {
        const fresh = layer(nextLayerName(ts), 0)
        destinationId = fresh.client_id
        return [{ ...fresh, clips: [clip] }, ...ts]
      }
      return ts.map(t => t.client_id === destinationId ? { ...t, clips: [...t.clips, clip] } : t)
    })
    set({ selectedClipId: clip.client_id, selectedTrackId: destinationId, playhead: start })
    return true
  },
  moveClip: (clipId, targetId, start) => {
    const state = get()
    const source = state.tracks.find(t => t.clips.some(c => c.client_id === clipId))
    const clip = source?.clips.find(c => c.client_id === clipId)
    const destination = state.tracks.find(t => t.client_id === targetId)
    if (!source || !clip || source.locked || (targetId && !destination) || (!destination && state.tracks.length >= MAX_LAYERS)) return false
    const bounded = roundTime(clamp(start, 0, MAX_TIME - clip.duration))
    if (destination && !canPlace(destination, bounded, clip.duration, clipId)) return false
    if (destination?.client_id === source.client_id && Math.abs(clip.start - bounded) < EPS) return true
    let finalId = targetId
    get().changeTracks(ts => {
      let updated = ts.map(t => ({ ...t, clips: t.clips.filter(c => c.client_id !== clipId) }))
      if (!finalId) {
        const fresh = layer(nextLayerName(updated), 0)
        finalId = fresh.client_id
        updated = [fresh, ...updated]
      }
      return updated.map(t => t.client_id === finalId ? { ...t, clips: [...t.clips, { ...clip, start: bounded }] } : t)
    })
    set({ selectedClipId: clipId, selectedTrackId: finalId, playhead: bounded })
    return true
  },
  trimClip: (clipId, edge, delta, pxPerSecond) => {
    const state = get()
    const track = state.tracks.find(t => t.clips.some(c => c.client_id === clipId))
    const clip = track?.clips.find(c => c.client_id === clipId)
    if (!track || !clip || track.locked) return false
    const sourceLength = clip.media_id ? state.mediaDurations[clip.media_id] : undefined
    let start = clip.start, duration = clip.duration, source_offset = clip.source_offset
    if (edge === 'right') {
      const maxDuration = Math.min(MAX_TIME - start, sourceLength && clip.type !== 'image' ? sourceLength - clip.source_offset : MAX_TIME)
      if (maxDuration < MIN_CLIP) return false
      const proposedEnd = snapTime(clip.start + clip.duration + delta, state.tracks, state.playhead, pxPerSecond, clipId)
      duration = roundTime(clamp(proposedEnd - start, MIN_CLIP, maxDuration))
    } else {
      const lower = clip.type === 'text' || clip.type === 'image' ? 0 : Math.max(0, clip.start - clip.source_offset)
      const upper = clip.start + clip.duration - MIN_CLIP
      const proposed = snapTime(clip.start + delta, state.tracks, state.playhead, pxPerSecond, clipId)
      start = roundTime(clamp(proposed, lower, upper))
      const change = start - clip.start
      duration = roundTime(clip.duration - change)
      source_offset = clip.type === 'text' || clip.type === 'image' ? clip.source_offset : roundTime(clip.source_offset + change)
    }
    if (!canPlace(track, start, duration, clipId)) return false
    if (Math.abs(start - clip.start) < EPS && Math.abs(duration - clip.duration) < EPS) return true
    get().changeTracks(ts => ts.map(t => t.client_id === track.client_id ? {
      ...t, clips: t.clips.map(c => c.client_id === clipId ? { ...c, start, duration, source_offset } : c),
    } : t))
    return true
  },
  patchClip: (id, patch) => {
    get().changeTracks(ts => {
      const track = ts.find(t => t.clips.some(c => c.client_id === id))
      const clip = track?.clips.find(c => c.client_id === id)
      if (!track || !clip || track.locked) return ts
      const candidate = { ...clip, ...patch }
      if (!canPlace(track, candidate.start, candidate.duration, id)) return ts
      return ts.map(t => t.client_id === track.client_id ? {
        ...t, clips: t.clips.map(c => c.client_id === id ? candidate : c),
      } : t)
    })
  },
  removeClip: id => {
    const state = get()
    if (state.tracks.some(t => t.locked && t.clips.some(c => c.client_id === id))) return
    get().changeTracks(ts => ts.map(t => ({ ...t, clips: t.clips.filter(c => c.client_id !== id) })))
    set({ selectedClipId: null })
  },
  undo: () => set(s => s.past.length ? { tracks: s.past.at(-1)!, past: s.past.slice(0, -1),
    future: [structuredClone(s.tracks), ...s.future].slice(0, 50), dirty: s.dirty + 1 } : {}),
  redo: () => set(s => s.future.length ? { tracks: s.future[0], future: s.future.slice(1),
    past: [...s.past.slice(-49), structuredClone(s.tracks)], dirty: s.dirty + 1 } : {}),
  markSaved: revision => set({ revision }),
}))
