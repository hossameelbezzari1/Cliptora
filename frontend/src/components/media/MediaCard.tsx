import { FileAudio2, FileImage, FileVideo, Plus, GripVertical } from 'lucide-react'
import type { DragEvent } from 'react'
import type { MediaAsset } from '../../types'
import { fileUrl } from '../../lib/api'
import { useEditor } from '../../stores/editorStore'
import { probeMediaDuration } from '../../lib/media'

export function MediaCard({ media, onAdd }: { media: MediaAsset; onAdd: (media: MediaAsset) => void }) {
  const startDrag = useEditor(s => s.startDrag)
  function drag(event: DragEvent<HTMLButtonElement>) {
    const known = useEditor.getState().mediaDurations[media.id]
    startDrag({ kind: 'media', mediaId: media.id, duration: media.kind === 'image' ? 5 : known ?? 8 })
    event.dataTransfer.setData('application/x-cliptora', String(media.id))
    event.dataTransfer.effectAllowed = 'copy'
    void probeMediaDuration(media).then(({ duration, measured }) => {
      if (measured) useEditor.getState().setMediaDuration(media.id, duration)
      const current = useEditor.getState().dragging
      if (current?.kind === 'media' && current.mediaId === media.id) {
        useEditor.getState().startDrag({ ...current, duration })
      }
    })
  }
  return <div className="group min-w-0">
    <button draggable onDragStart={drag} onDragEnd={() => startDrag(null)} onClick={() => onAdd(media)}
      className="relative aspect-[1.3] w-full cursor-grab overflow-hidden rounded-lg bg-[#101214] hover:ring-1 hover:ring-cl-cyan active:cursor-grabbing"
      title={`Drag ${media.name} to a timeline layer, or click to add it`}>
      {media.kind === 'image' ? <img src={fileUrl(media.id)} className="h-full w-full object-cover" alt={media.name} draggable={false}/>
        : media.kind === 'video' ? <video src={fileUrl(media.id)} preload="metadata" muted className="h-full w-full object-cover" draggable={false}/>
          : <FileAudio2 className="mx-auto text-cl-cyan" size={31}/>}
      <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100"><Plus className="rounded-full bg-cl-purple p-1" size={32}/></span>
      <span className="absolute top-1 right-1 rounded bg-black/65 p-1 text-white/80"><GripVertical size={13}/></span>
      <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1.5 py-0.5 text-[9px] uppercase">{media.kind === 'video' ? <FileVideo size={11}/> : media.kind === 'image' ? <FileImage size={11}/> : <FileAudio2 size={11}/>}</span>
    </button>
    <p className="mt-1 truncate text-center text-[11px] text-[#b5b9bd]" title={media.name}>{media.name}</p>
  </div>
}
