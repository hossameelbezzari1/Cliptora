import { useState } from 'react'
import { AudioLines, Check, Clipboard, Film, Folder, Image as ImageIcon, Plus, Tag, X } from 'lucide-react'
import type { MediaAsset } from '../../../types'
import type { MediaFolder } from './useMediaOrganization'
import { formatDuration, mediaDate, mediaDimensions, mediaDuration, mediaFormat, mediaName, mediaSize, mediaSource } from './mediaLibraryUtils'

type Props = {
  media: MediaAsset | null
  folders: MediaFolder[]
  folderId: string
  tags: string[]
  onFolder: (id: string) => void
  onAddTag: (tag: string) => void
  onRemoveTag: (tag: string) => void
  onAdd: () => void
}

export function MediaDetailsPanel({media, folders, folderId, tags, onFolder, onAddTag, onRemoveTag, onAdd}: Props) {
  const [tagText, setTagText] = useState('')
  const [tagOpen, setTagOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  if (!media) return <div className="grid h-full min-h-[260px] place-content-center gap-2 rounded-xl border border-[#303642] bg-[#151a20] p-5 text-center text-[#8e99a9]"><ImageIcon size={27} className="mx-auto"/><p className="text-xs">Choose a media asset to see its details.</p></div>
  const source = mediaSource(media)
  const kind = media.kind
  const submitTag = () => {onAddTag(tagText);setTagText('');setTagOpen(false)}
  const copyPath = async () => {
    try {await navigator.clipboard.writeText(source);setCopied(true)} catch {setCopied(false)}
  }
  return <div className="flex min-w-0 flex-col gap-3 pb-2 text-white">
    <div className="relative aspect-video shrink-0 overflow-hidden rounded-xl border border-[#353d48] bg-[#0b0f15]">
      {kind==='image' ? <img src={source} alt={mediaName(media)} className="h-full w-full object-contain"/>
        : kind==='video' ? <video key={media.id} src={source} controls playsInline preload="metadata" className="h-full w-full object-contain" aria-label={`Preview ${mediaName(media)}`}/>
        : <div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#251f3d] to-[#0b141e] text-[#b392fa]"><AudioLines size={35}/><audio key={media.id} src={source} controls preload="metadata" className="w-[92%]"/></div>}
    </div>
    <section className="rounded-xl border border-[#303744] bg-[#171d25] p-3">
      <div className="flex items-start gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#342850] text-[#bd9bf8]">{kind==='video'?<Film size={20}/>:kind==='audio'?<AudioLines size={20}/>:<ImageIcon size={20}/>}</div>
        <div className="min-w-0 flex-1"><h3 className="break-words text-[12px] font-semibold">{mediaName(media)}</h3><p className="mt-1 text-[10px] capitalize text-[#a4aabb]">{kind} · {mediaFormat(media)}</p></div>
      </div>
      <button type="button" onClick={onAdd} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#753fdb] px-3 py-2.5 text-[11px] font-semibold text-white hover:bg-[#8e55fa]"><Plus size={15}/>Add to timeline</button>
      <dl className="mt-3 space-y-2 border-t border-[#303844] pt-3 text-[10px]">
        {([['Duration', formatDuration(mediaDuration(media))],['Resolution',mediaDimensions(media)],['File size',mediaSize(media)],['Date added',mediaDate(media)],['Format',mediaFormat(media)]] as const).map(([label,value])=><div key={label} className="flex items-start justify-between gap-2"><dt className="text-[#9da7b5]">{label}</dt><dd className="min-w-0 break-words text-right text-[#f0edf6]">{value}</dd></div>)}
        <div className="flex items-center justify-between gap-2"><dt className="text-[#9da7b5]">Media URL</dt><dd><button type="button" onClick={()=>void copyPath()} title="Copy media URL" aria-label="Copy media URL" className="rounded-md border border-[#394151] p-1.5 text-[#d4c1fa] hover:bg-[#372a51]">{copied?<Check size={13}/>:<Clipboard size={13}/>}</button></dd></div>
      </dl>
      <div className="mt-3 border-t border-[#303844] pt-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold"><Tag size={13} className="text-[#ad89ed]"/>Tags</div>
        <div className="flex flex-wrap gap-1.5">{tags.map(tag=><span key={tag} className="inline-flex items-center gap-1 rounded-full border border-[#3c4557] bg-[#232b37] px-2 py-1 text-[10px]">{tag}<button type="button" onClick={()=>onRemoveTag(tag)} aria-label={`Remove tag ${tag}`}><X size={11}/></button></span>)}
          {tagOpen?<form className="flex min-w-0 flex-1 gap-1" onSubmit={event=>{event.preventDefault();submitTag()}}><input autoFocus className="min-w-0 flex-1 rounded border border-[#604e7e] bg-[#10151d] px-2 py-1 text-[10px] outline-none" maxLength={36} placeholder="Tag name" value={tagText} onChange={event=>setTagText(event.target.value)}/><button type="submit" className="rounded bg-[#7847d5] px-2 text-[10px]" disabled={!tagText.trim()}>Add</button></form>:<button type="button" className="inline-flex items-center gap-1 rounded-lg border border-[#3b4452] px-2 py-1 text-[10px] text-[#b3bbce] hover:border-[#8d68d2]" onClick={()=>setTagOpen(true)}><Plus size={12}/>Add tag</button>}</div>
      </div>
    </section>
    <section className="rounded-xl border border-[#303744] bg-[#171d25] p-3">
      <label className="mb-2 flex items-center gap-2 text-[11px] font-semibold" htmlFor="cl-media-folder-select"><Folder size={14} className="text-[#b494e9]"/>Folder</label>
      <select id="cl-media-folder-select" className="w-full min-w-0 rounded-lg border border-[#3c4352] bg-[#10161f] px-2.5 py-2 text-[11px] text-white outline-none focus:border-[#9768ec]" value={folderId} onChange={event=>onFolder(event.target.value)}>
        <option value="">Unassigned</option>{folders.map(folder=><option key={folder.id} value={folder.id}>{folder.name}</option>)}
      </select>
      <p className="mt-2 text-[10px] leading-4 text-[#8592a5]">Folders and tags are saved locally on this browser, not to MySQL.</p>
    </section>
  </div>
}
