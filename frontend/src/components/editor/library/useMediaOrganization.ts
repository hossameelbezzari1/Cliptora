import { useEffect, useState } from 'react'

export type MediaFolder = { id: string; name: string }
type Store = { projectKey: string; folders: MediaFolder[]; assignments: Record<string, string>; tags: Record<string, string[]> }

function keyFor(projectId: string) { return `cliptora:media-organization:v1:${projectId}` }
function load(projectId: string): Store {
  const empty: Store = { projectKey: projectId, folders: [], assignments: {}, tags: {} }
  try {
    const stored = window.localStorage.getItem(keyFor(projectId))
    if (!stored) return empty
    const value = JSON.parse(stored) as Partial<Store>
    return {
      projectKey: projectId,
      folders: Array.isArray(value.folders) ? value.folders.filter(x => x && typeof x.id === 'string' && typeof x.name === 'string') : [],
      assignments: value.assignments && typeof value.assignments === 'object' ? value.assignments : {},
      tags: value.tags && typeof value.tags === 'object' ? value.tags : {},
    }
  } catch { return empty }
}
const newId = () => `folder-${Date.now()}-${Math.random().toString(36).slice(2,9)}`

/** UI organization only. Media is uploaded via the existing API; folders/tags are local per project/browser. */
export function useMediaOrganization(projectId: string) {
  const [store, setStore] = useState<Store>(() => load(projectId))
  useEffect(() => { setStore(load(projectId)) }, [projectId])
  useEffect(() => {
    if (store.projectKey !== projectId) return
    try { window.localStorage.setItem(keyFor(projectId), JSON.stringify(store)) } catch { /* Storage disabled/full */ }
  }, [store, projectId])
  const update = (apply: (current: Store) => Store) => setStore(current => apply(current.projectKey === projectId ? current : load(projectId)))
  const createFolder = (value: string) => {
    const name = value.trim().slice(0,80)
    if (!name) return
    update(s => s.folders.some(f => f.name.toLowerCase() === name.toLowerCase()) ? s : { ...s, folders: [...s.folders, {id:newId(),name}] })
  }
  const renameFolder = (id: string, value: string) => {
    const name = value.trim().slice(0,80)
    if (!name) return
    update(s => ({ ...s, folders: s.folders.map(f => f.id === id ? {...f, name} : f) }))
  }
  const deleteFolder = (id: string) => update(s => ({
    ...s,
    folders: s.folders.filter(f => f.id !== id),
    assignments: Object.fromEntries(Object.entries(s.assignments).filter(([,folderId]) => folderId !== id)),
  }))
  const setFolder = (mediaId: number, folderId: string) => update(s => {
    const assignments = { ...s.assignments }
    if (!folderId) delete assignments[String(mediaId)]
    else assignments[String(mediaId)] = folderId
    return { ...s, assignments }
  })
  const addTag = (mediaId: number, value: string) => {
    const tag = value.trim().slice(0,36)
    if (!tag) return
    update(s => {
      const before = s.tags[String(mediaId)] ?? []
      if (before.some(item => item.toLowerCase() === tag.toLowerCase())) return s
      return { ...s, tags: { ...s.tags, [String(mediaId)]: [...before, tag] } }
    })
  }
  const removeTag = (mediaId: number, value: string) => update(s => ({
    ...s, tags: { ...s.tags, [String(mediaId)]: (s.tags[String(mediaId)] ?? []).filter(tag => tag !== value) },
  }))
  return { folders: store.folders, assignments: store.assignments, tags: store.tags,
    createFolder, renameFolder, deleteFolder, setFolder, addTag, removeTag }
}
