import { useEffect, useState } from 'react'
import { loadSubtitles, makeSubtitleDoc, parseSubtitleText, subtitleId, type SubtitleCue, type SubtitleDoc } from './subtitleUtils'

/** Documents are local to a project/browser. No unverified MySQL endpoint is used. */
export function useSubtitlesLibrary(projectId: string) {
  const [docs, setDocs] = useState<SubtitleDoc[]>(() => loadSubtitles(projectId))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [storageError, setStorageError] = useState('')
  useEffect(() => {
    try {
      localStorage.setItem(`cliptora.subtitles.v1.${projectId}`, JSON.stringify(docs))
      setStorageError('')
    } catch { setStorageError('Browser storage is full or unavailable. Export your subtitles before leaving.') }
  }, [docs, projectId])
  const selected = docs.find(doc => doc.id === selectedId) ?? null

  function create() {
    const doc = makeSubtitleDoc('New Subtitles', 'draft', [
      { id: subtitleId(), start: 0, end: 3, text: '' },
    ])
    setDocs(before => [doc, ...before])
    setSelectedId(doc.id)
    return doc.id
  }
  async function importFile(file: File) {
    if (file.size > 5 * 1024 * 1024) throw new Error('Subtitle file is too large (max 5 MB).')
    if (!/\.(srt|vtt)$/i.test(file.name)) throw new Error('Only .srt and .vtt files are supported.')
    const cues = parseSubtitleText(await file.text())
    const doc = makeSubtitleDoc(file.name.replace(/\.(srt|vtt)$/i, ''), 'imported', cues)
    setDocs(before => [doc, ...before])
    setSelectedId(doc.id)
    return doc.id
  }
  function update(id: string, patch: Partial<SubtitleDoc>) {
    setDocs(before => before.map(doc => doc.id === id
      ? { ...doc, ...patch, id: doc.id, cues: patch.cues ?? doc.cues, updatedAt: Date.now() }
      : doc))
  }
  function updateCue(docId: string, cueId: string, patch: Partial<SubtitleCue>) {
    setDocs(before => before.map(doc => doc.id === docId
      ? { ...doc, updatedAt: Date.now(), cues: doc.cues.map(cue => cue.id === cueId ? { ...cue, ...patch, id: cue.id } : cue) }
      : doc))
  }
  function addCue(docId: string) {
    const doc = docs.find(d => d.id === docId)
    if (!doc) return null
    const lastEnd = Math.max(0, ...doc.cues.map(cue => cue.end))
    const cue = { id: subtitleId(), start: lastEnd, end: lastEnd + 3, text: '' }
    update(docId, { cues: [...doc.cues, cue] })
    return cue.id
  }
  function deleteCue(docId: string, cueId: string) {
    const doc = docs.find(d => d.id === docId)
    if (doc) update(docId, { cues: doc.cues.filter(cue => cue.id !== cueId) })
  }
  function duplicate(id: string) {
    const doc = docs.find(d => d.id === id)
    if (!doc) return
    const copy = {
      ...doc, id: subtitleId(), title: `${doc.title} (copy)`, kind: 'draft' as const,
      favorite: false, createdAt: Date.now(), updatedAt: Date.now(),
      cues: doc.cues.map(cue => ({ ...cue, id: subtitleId() })),
      tags: [...doc.tags], style: { ...doc.style },
    }
    setDocs(before => [copy, ...before])
    setSelectedId(copy.id)
  }
  function remove(id: string) {
    if (!window.confirm('Delete this subtitle document? This cannot be undone.')) return
    setDocs(before => before.filter(doc => doc.id !== id))
    if (selectedId === id) setSelectedId(null)
  }
  return { docs, selected, selectedId, setSelectedId, storageError, create, importFile, update, updateCue, addCue, deleteCue, duplicate, remove }
}
export type SubtitleLibraryModel = ReturnType<typeof useSubtitlesLibrary>
