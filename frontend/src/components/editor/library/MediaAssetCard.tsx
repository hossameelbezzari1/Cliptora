import type { DragEvent } from 'react'
import { AudioLines, Film, Image as ImageIcon, Plus } from 'lucide-react'
import type { MediaAsset } from '../../../types'
import { formatDuration, mediaDimensions, mediaDuration, mediaName, mediaSize, mediaSource } from './mediaLibraryUtils'

type Props = {
  media: MediaAsset
  selected: boolean
  view: 'grid'|'list'
  onSelect: () => void
  onAdd: () => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}
const wave = Array.from({length:36},(_,i)=>7+Math.abs(Math.sin(i*1.93)*Math.cos(i*.43))*39)

export function MediaAssetCard({media,selected,view,onSelect,onAdd,onDragStart,onDragEnd}:Props) {
  const kind = media.kind
  const source = mediaSource(media)
  const picture = kind === 'image' ? <img src={source} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover"/>
    : kind === 'video' ? <video src={source} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" aria-hidden="true"/>
    : <div className="flex h-full w-full items-center justify-center gap-[2px] bg-gradient-to-br from-[#16142d] via-[#272053] to-[#121b28] px-2">{wave.map((h,i)=><i key={i} className="w-[2px] shrink-0 rounded-full bg-[#a478f8]" style={{height:`${h}%`}}/>)}</div>
  const icon = kind==='video' ? <Film size={13}/> : kind==='audio' ? <AudioLines size={13}/> : <ImageIcon size={13}/>
  return <article draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onSelect} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect()}}} tabIndex={0}
    role="button" aria-pressed={selected} title={`Select ${mediaName(media)}. Drag into Timeline to add.`}
    className={`group relative min-w-0 cursor-grab overflow-hidden rounded-xl border text-left text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ac84ff] ${selected?'border-[#a37af9] bg-[#202136] ring-1 ring-[#9975ea]/70':'border-[#323843] bg-[#151a22] hover:border-[#7758b7] hover:bg-[#1c202c]'} ${view==='list'?'flex items-center gap-3 p-2':'p-1.5'}`}>
    <div className={`relative shrink-0 overflow-hidden rounded-lg bg-[#1d242d] ${view==='list'?'h-[62px] w-[104px]':'aspect-[16/10] w-full'}`}>
      {picture}
      <span className="absolute left-1.5 bottom-1.5 rounded-md bg-[#10131b]/85 p-1 text-[#eae6f9]">{icon}</span>
      {mediaDuration(media)!==null&&<span className="absolute bottom-1 right-1 rounded bg-[#0b1017]/85 px-1.5 py-0.5 text-[10px] text-white">{formatDuration(mediaDuration(media))}</span>}
    </div>
    <div className={`min-w-0 flex-1 ${view==='list'?'pr-2':'px-1 py-2'}`}>
      <p className="truncate text-[11px] font-semibold" title={mediaName(media)}>{mediaName(media)}</p>
      <p className="mt-1 truncate text-[10px] text-[#9ba5b5]">{mediaDimensions(media)} · {mediaSize(media)}</p>
      <p className="mt-0.5 text-[10px] capitalize text-[#7f899d]">{kind}</p>
    </div>
    <button type="button" onClick={event=>{event.stopPropagation();onAdd()}} title={`Add ${mediaName(media)} to Timeline`} aria-label={`Add ${mediaName(media)} to Timeline`} className={`rounded-lg bg-[#342747] p-1.5 text-[#dcc5ff] hover:bg-[#7846d4] hover:text-white ${view==='list'?'mr-1':'absolute right-3 top-3 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100'}`}><Plus size={14}/></button>
  </article>
}
