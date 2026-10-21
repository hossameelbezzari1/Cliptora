import { create } from 'zustand'
import type { Track, Clip, ClipProperties, MediaAsset, Timeline } from '../types'
import { uid } from '../lib/api'
import type { PreviewTool } from '../components/editor/preview/previewGeometry'

export type DragItem =
  | { kind: 'clip'; clipId: string; offset: number; duration: number }
  | { kind: 'media'; mediaId: number; duration: number }
  | { kind: 'text'; duration: number }
  | { kind: 'shape'; shape: string; duration: number }

export const MIN_CLIP = 0.1
export const MAX_TIME = 14400
export const MAX_LAYERS = 100
const EPS = 0.0001
const roundTime = (value: number) => Math.round(value * 100) / 100
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const layer = (name: string, position: number): Track => ({ client_id: uid(), name, type: 'mixed', position, hidden: false, muted: false, locked: false, background_color: '#101214', clips: [] })
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
  playhead: number; playing: boolean; previewTool: PreviewTool; setPreviewTool: (tool: PreviewTool) => void; selectedClipId: string | null; selectedTrackId: string | null
  dragging: DragItem | null; dirty: number; past: Track[][]; future: Track[][]; clipboard: Clip | null
  hydrate: (projectId: number, timeline: Timeline) => void
  setMedia: (media: MediaAsset[]) => void; setMediaDuration: (id: number, seconds: number) => void
  setPlayhead: (seconds: number) => void; setPlaying: (yes: boolean) => void
  selectClip: (id: string | null) => void; selectTrack: (id: string | null) => void
  startDrag: (item: DragItem | null) => void
  changeTracks: (fn: (tracks: Track[]) => Track[]) => void
  addTrack: (insertion?: 'top' | 'bottom') => void; duplicateTrack: (id:string) => void; patchTrack: (id:string, patch:Partial<Track>) => void; renameTrack: (id: string, name: string) => void
  moveTrack: (id:string, direction:'up'|'down') => void; reorderTrack: (id:string, targetId:string, above:boolean) => void
  toggleTrack: (id: string, key: 'hidden' | 'muted' | 'locked') => void; removeTrack: (id: string) => void
  addMediaClip: (media: MediaAsset, duration: number) => void
  addMediaClipAt: (media: MediaAsset, duration: number, targetId: string | null, start: number, insertion?: 'top'|'bottom') => boolean
  addTextClip: () => void; addTextClipAt: (targetId: string | null, start: number, insertion?: 'top'|'bottom') => boolean
  addShapeClip: (shape: string) => boolean; addShapeClipAt: (targetId: string | null, start: number, shape: string, insertion?: 'top'|'bottom') => boolean
  moveClip: (clipId: string, targetId: string | null, start: number, insertion?: 'top'|'bottom') => boolean
  trimClip: (clipId: string, edge: 'left' | 'right', delta: number, pixelsPerSecond: number) => boolean
  patchClip: (id: string, patch: Partial<Clip>) => void; patchProps: (id: string, patch: Partial<ClipProperties>) => void
  duplicateClip: (id:string) => void; splitClip: (id:string, time:number) => boolean
  detachAudio: (id:string) => void; mergeAudio: (id:string) => void; cutClip: (id:string) => void; pasteClip: () => void
  removeClip: (id: string) => void
  undo: () => void; redo: () => void; markSaved: (revision: number) => void
}

export const useEditor = create<Store>((set, get) => ({
  projectId: null, revision: 1, tracks: [], media: [], mediaDurations: {}, playhead: 0, playing: false, previewTool: 'select', setPreviewTool: previewTool => set({previewTool}),
  selectedClipId: null, selectedTrackId: null, dragging: null, dirty: 0, past: [], future: [], clipboard: null,
  hydrate: (projectId, timeline) => {
    const missing = timeline.tracks.length === 0
    const tracks = missing ? defaultLayers() : normalize(timeline.tracks)
    set({ projectId, revision: timeline.revision, tracks, playhead: 0, playing: false, selectedClipId: null,
      selectedTrackId: tracks[tracks.length - 1]?.client_id ?? null, previewTool: 'select', dragging: null, dirty: missing ? 1 : 0,
      mediaDurations: {}, past: [], future: [], clipboard: null })
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
  // The array is stored bottom -> top (positions ascending). Timeline displays it in reverse.
  // Manual layer controls can add above or below the full layer stack.
  addTrack: (insertion = 'top') => {
    const tracks = get().tracks
    if (tracks.length >= MAX_LAYERS) return
    const fresh = layer(nextLayerName(tracks), tracks.length)
    get().changeTracks(ts => ts.length < MAX_LAYERS ? (insertion === 'top' ? [...ts, fresh] : [fresh, ...ts]) : ts)
    if (get().tracks.some(t => t.client_id === fresh.client_id)) {
      set({ selectedTrackId: fresh.client_id, selectedClipId: null })
    }
  },
  patchTrack: (id, patch) => get().changeTracks(ts => ts.map(t => t.client_id === id ? { ...t, ...patch } : t)),
  duplicateTrack: id => get().changeTracks(ts => {
    if (ts.length >= MAX_LAYERS) return ts
    const i = ts.findIndex(t => t.client_id === id)
    if (i < 0) return ts
    const copy = structuredClone(ts[i])
    copy.client_id = uid(); copy.name = `${copy.name} copy`.slice(0, 100)
    copy.clips = copy.clips.map(c => ({ ...c, client_id: uid(), props: {...c.props, attached_to: null} }))
    return [...ts.slice(0, i + 1), copy, ...ts.slice(i + 1)]
  }),
  // 'Up' and 'down' are defined by the visible top-to-bottom Timeline order.
  moveTrack: (id, direction) => get().changeTracks(ts => {
    const from = ts.findIndex(t => t.client_id === id)
    const to = from + (direction === 'up' ? 1 : -1)
    if (from < 0 || ts[from].locked || to < 0 || to >= ts.length) return ts
    const next = [...ts]
    ;[next[from], next[to]] = [next[to], next[from]]
    return next
  }),
  reorderTrack: (id, targetId, above) => get().changeTracks(ts => {
    if (id === targetId) return ts
    const from = ts.findIndex(t => t.client_id === id)
    if (from < 0 || ts[from].locked || !ts.some(t => t.client_id === targetId)) return ts
    const next = [...ts]
    const [moving] = next.splice(from, 1)
    const target = next.findIndex(t => t.client_id === targetId)
    next.splice(target + (above ? 1 : 0), 0, moving)
    return next.every((t, i) => t === ts[i]) ? ts : next
  }),
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
    const safeDuration = Math.max(MIN_CLIP, Math.min(duration, state.mediaDurations[media.id] || duration))
    const at = roundTime(state.playhead)
    const preferred = state.tracks.find(t => t.client_id === state.selectedTrackId)
    const candidates = [preferred, ...[...state.tracks].reverse()].filter((t, i, a): t is Track => !!t && a.findIndex(other => other?.client_id === t.client_id) === i)
    for (const track of candidates) {
      if (canPlace(track, at, safeDuration) && get().addMediaClipAt(media, safeDuration, track.client_id, at)) return
    }
    if (state.tracks.length < MAX_LAYERS) get().addMediaClipAt(media, safeDuration, null, at, 'top')
  },
  addMediaClipAt: (media, seconds, targetId, start, insertion = 'bottom') => {
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
      start: roundTime(start), duration: roundTime(safeDuration), source_offset: 0, text: null, color: '#5bff93', props: {} }
    let destinationId = targetId
    get().changeTracks(ts => {
      if (!destinationId) {
        const fresh = layer(nextLayerName(ts), 0)
        destinationId = fresh.client_id
        const created = { ...fresh, clips: [clip] }
        return insertion === 'top' ? [...ts, created] : [created, ...ts]
      }
      return ts.map(t => t.client_id === destinationId ? { ...t, clips: [...t.clips, clip] } : t)
    })
    set({ selectedClipId: clientId, selectedTrackId: destinationId, playhead: start })
    return true
  },
  addTextClip: () => {
    const state = get()
    const at = roundTime(state.playhead)
    const preferred = state.tracks.find(t => t.client_id === state.selectedTrackId)
    const candidates = [preferred, ...[...state.tracks].reverse()].filter((t, i, a): t is Track => !!t && a.findIndex(other => other?.client_id === t.client_id) === i)
    for (const track of candidates) {
      if (canPlace(track, at, 5) && get().addTextClipAt(track.client_id, at)) return
    }
    if (state.tracks.length < MAX_LAYERS) get().addTextClipAt(null, at, 'top')
  },
  addShapeClip: (shape) => {
    const state = get()
    const at = roundTime(state.playhead)
    const preferred = state.tracks.find(t => t.client_id === state.selectedTrackId)
    const candidates = [preferred, ...[...state.tracks].reverse()].filter((t, i, a): t is Track => !!t && a.findIndex(other => other?.client_id === t.client_id) === i)
    for (const track of candidates) {
      if (canPlace(track, at, 5) && get().addShapeClipAt(track.client_id, at, shape)) return true
    }
    return state.tracks.length < MAX_LAYERS ? get().addShapeClipAt(null, at, shape, 'top') : false
  },
  addShapeClipAt: (targetId, start, shape, insertion = 'bottom') => {
    const before = get().dirty
    if (!get().addTextClipAt(targetId, start, insertion) || get().dirty === before) return false
    const id = get().selectedClipId
    if (!id) return false
    if (shape !== 'Text') {
      const palette: Record<string, string> = { Rectangle:'#318bf6', Square:'#925aff', Circle:'#f74f79', Ellipse:'#22d39a', Triangle:'#ffb64d', Polygon:'#9b61ed', Star:'#ffd05e', Line:'#5acafa', Arrow:'#51dfae' }
      get().patchProps(id, { shape_kind: shape, width: shape === 'Square' || shape === 'Circle' ? 25 : 45, height: shape === 'Square' || shape === 'Circle' ? 25 : 35, follow_target_id:undefined })
      get().patchClip(id, { name:shape, text:'', color:palette[shape] ?? '#a580db' })
    }
    return true
  },
  addTextClipAt: (targetId, start, insertion = 'bottom') => {
    const state = get()
    const target = state.tracks.find(t => t.client_id === targetId)
    if (targetId && !target) return false
    if (!target && state.tracks.length >= MAX_LAYERS) return false
    if (!canPlace(target ?? layer('Temp', 0), start, 5)) return false
    const clip: Clip = { client_id: uid(), name: 'New text', type: 'text', media_id: null,
      start: roundTime(start), duration: 5, source_offset: 0, text: 'Your text here', color: '#5bff93', props: {x:20,y:35,width:60,height:22} }
    let destinationId = targetId
    get().changeTracks(ts => {
      if (!destinationId) {
        const fresh = layer(nextLayerName(ts), 0)
        destinationId = fresh.client_id
        const created = { ...fresh, clips: [clip] }
        return insertion === 'top' ? [...ts, created] : [created, ...ts]
      }
      return ts.map(t => t.client_id === destinationId ? { ...t, clips: [...t.clips, clip] } : t)
    })
    set({ selectedClipId: clip.client_id, selectedTrackId: destinationId, playhead: start })
    return true
  },
  moveClip: (clipId, targetId, start, insertion = 'bottom') => {
    const state = get()
    const source = state.tracks.find(t => t.clips.some(c => c.client_id === clipId))
    const clip = source?.clips.find(c => c.client_id === clipId)
    const destination = state.tracks.find(t => t.client_id === targetId)
    if (!source || !clip || source.locked || clip.locked || (targetId && !destination) || (!destination && state.tracks.length >= MAX_LAYERS)) return false
    const bounded = roundTime(clamp(start, 0, MAX_TIME - clip.duration))
    if (destination && !canPlace(destination, bounded, clip.duration, clipId)) return false
    if (destination?.client_id === source.client_id && Math.abs(clip.start - bounded) < EPS) return true
    let finalId = targetId
    get().changeTracks(ts => {
      let updated = ts.map(t => ({ ...t, clips: t.clips.filter(c => c.client_id !== clipId) }))
      if (!finalId) {
        const fresh = layer(nextLayerName(updated), 0)
        finalId = fresh.client_id
        updated = insertion === 'top' ? [...updated, fresh] : [fresh, ...updated]
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
    if (!track || !clip || track.locked || clip.locked) return false
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
      if (!track || !clip || track.locked || (clip.locked && patch.locked === undefined)) return ts
      const candidate = { ...clip, ...patch }
      if (!canPlace(track, candidate.start, candidate.duration, id) || !candidate.name.trim()) return ts
      const mediaSeconds=candidate.media_id ? get().mediaDurations[candidate.media_id] : undefined
      if (mediaSeconds && candidate.type !== 'image' && candidate.source_offset + candidate.duration > mediaSeconds + EPS) return ts
      return ts.map(t => t.client_id === track.client_id ? {
        ...t, clips: t.clips.map(c => c.client_id === id ? candidate : c),
      } : t)
    })
  },
  patchProps: (id, patch) => {
    const clip = get().tracks.flatMap(t => t.clips).find(c => c.client_id === id)
    if (!clip) return
    get().patchClip(id, { props: { ...clip.props, ...patch } })
  },
  duplicateClip: id => {
    const state = get()
    const track = state.tracks.find(t => t.clips.some(c => c.client_id === id))
    const clip = track?.clips.find(c => c.client_id === id)
    if (!clip || !track || track.locked) return
    const copied = { ...structuredClone(clip), client_id: uid(), name: `${clip.name} copy`.slice(0,160), props:{...clip.props,attached_to:null} }
    let start = clip.start + clip.duration
    while (start + clip.duration <= MAX_TIME && !canPlace(track, start, clip.duration)) start = Math.max(start + MIN_CLIP, ...track.clips.filter(c => c.start + c.duration > start).map(c => c.start + c.duration))
    if (start + clip.duration > MAX_TIME) return
    copied.start = roundTime(start)
    get().changeTracks(ts => ts.map(t => t.client_id === track.client_id ? { ...t, clips: [...t.clips,copied] } : t))
    set({selectedClipId: copied.client_id,selectedTrackId:track.client_id})
  },
  splitClip: (id,time) => {
    const state=get()
    const track=state.tracks.find(t=>t.clips.some(c=>c.client_id===id))
    const clip=track?.clips.find(c=>c.client_id===id)
    if(!track||!clip||track.locked || time <= clip.start+MIN_CLIP || time>=clip.start+clip.duration-MIN_CLIP)return false
    const duration=roundTime(time-clip.start)
    const second:Clip={...structuredClone(clip),client_id:uid(),start:roundTime(time), duration:roundTime(clip.duration-duration), source_offset:clip.type==='image'||clip.type==='text'?clip.source_offset:roundTime(clip.source_offset+duration),props:{...clip.props,attached_to:null}}
    get().changeTracks(ts=>ts.map(t=>t.client_id===track.client_id?{...t,clips:t.clips.flatMap(c=>c.client_id===id?[{...c,duration},second]:[c])}:t))
    set({selectedClipId:second.client_id})
    return true
  },
  detachAudio: id => {
    const state=get(), track=state.tracks.find(t=>t.clips.some(c=>c.client_id===id)), clip=track?.clips.find(c=>c.client_id===id)
    if(!clip||!track||clip.type!=='video'||!clip.media_id||track.locked||state.tracks.length>=MAX_LAYERS||clip.props?.audio_muted)return
    const audioLayer=layer(`${clip.name.slice(0,70)} audio`, state.tracks.length)
    audioLayer.clips=[{...structuredClone(clip),client_id:uid(),name:`${clip.name} sound`.slice(0,160),type:'audio',props:{...clip.props,attached_to:clip.client_id,audio_muted:false}}]
    get().changeTracks(ts=>[...ts.map(t=>t.client_id===track.client_id?{...t,clips:t.clips.map(c=>c.client_id===id?{...c,props:{...c.props,audio_muted:true}}:c)}:t),audioLayer])
    set({selectedClipId:audioLayer.clips[0].client_id,selectedTrackId:audioLayer.client_id})
  },
  mergeAudio: id => {
    const state=get(), clips=state.tracks.flatMap(t=>t.clips)
    const source=clips.find(c=>c.client_id===id)
    const audio=source?.type==='audio'&&source.props?.attached_to?source:clips.find(c=>c.props?.attached_to===id)
    const parent=audio&&clips.find(c=>c.client_id===audio.props?.attached_to)
    if(!audio||!parent || parent.type!=='video'||audio.media_id!==parent.media_id||audio.start!==parent.start||audio.duration!==parent.duration||audio.source_offset!==parent.source_offset)return
    if(state.tracks.some(t=>t.locked&&t.clips.some(c=>[audio.client_id,parent.client_id].includes(c.client_id))))return
    get().changeTracks(ts=>ts.map(t=>({...t,clips:t.clips.filter(c=>c.client_id!==audio.client_id).map(c=>c.client_id===parent.client_id?{...c,props:{...c.props,audio_muted:false}}:c)})))
    set({selectedClipId:parent.client_id})
  },
  cutClip: id => {
    const state=get(), track=state.tracks.find(t=>t.clips.some(c=>c.client_id===id)), clip=track?.clips.find(c=>c.client_id===id)
    if (!clip||track?.locked||clip.locked)return
    set({clipboard:structuredClone(clip)})
    get().removeClip(id)
  },
  pasteClip: () => {
    const state=get(), clip=state.clipboard
    const track=state.tracks.find(t=>t.client_id===state.selectedTrackId&&!t.locked)??state.tracks.find(t=>!t.locked)
    if(!clip||!track || !canPlace(track,state.playhead,clip.duration))return
    const copied:Clip={...structuredClone(clip),client_id:uid(),start:roundTime(state.playhead),props:{...clip.props,attached_to:null}}
    get().changeTracks(ts=>ts.map(t=>t.client_id===track.client_id?{...t,clips:[...t.clips,copied]}:t))
    set({selectedClipId:copied.client_id,selectedTrackId:track.client_id})
  },
  removeClip: id => {
    const state = get()
    if (state.tracks.some(t => t.clips.some(c => c.client_id === id && (c.locked || t.locked)))) return
    get().changeTracks(ts => ts.map(t => ({ ...t, clips: t.clips.filter(c => c.client_id !== id) })))
    set({ selectedClipId: null })
  },
  undo: () => set(s => s.past.length ? { tracks: s.past.at(-1)!, past: s.past.slice(0, -1),
    future: [structuredClone(s.tracks), ...s.future].slice(0, 50), dirty: s.dirty + 1 } : {}),
  redo: () => set(s => s.future.length ? { tracks: s.future[0], future: s.future.slice(1),
    past: [...s.past.slice(-49), structuredClone(s.tracks)], dirty: s.dirty + 1 } : {}),
  markSaved: revision => set({ revision }),
}))
