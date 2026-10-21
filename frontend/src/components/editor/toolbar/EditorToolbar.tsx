import { useState } from 'react'
import {
  Crop, Download, Maximize2, MousePointer2, Move, Plus, Redo2,
  RotateCw, Save, Scaling, Scissors, Undo2, ChevronDown,
} from 'lucide-react'
import { useEditor, MIN_CLIP } from '../../../stores/editorStore'
import type { Project } from '../../../types'
import type { PreviewTool } from '../preview/previewGeometry'

const tools: { id:PreviewTool; label:string; icon:typeof Move }[] = [
  {id:'select',label:'Select',icon:MousePointer2},
  {id:'move',label:'Move',icon:Move},
  {id:'resize',label:'Resize',icon:Maximize2},
  {id:'rotate',label:'Rotate',icon:RotateCw},
  {id:'scale',label:'Scale',icon:Scaling},
  {id:'crop',label:'Crop',icon:Crop},
]

export function EditorToolbar({onSave,project}:{onSave:()=>void;project:Project}){
 const undo=useEditor(s=>s.undo), redo=useEditor(s=>s.redo)
 const past=useEditor(s=>s.past), future=useEditor(s=>s.future)
 const addText=useEditor(s=>s.addTextClip), clipId=useEditor(s=>s.selectedClipId)
 const tracks=useEditor(s=>s.tracks), playhead=useEditor(s=>s.playhead)
 const tool=useEditor(s=>s.previewTool), setTool=useEditor(s=>s.setPreviewTool)
 const [showObjects,setShowObjects]=useState(false)
 const clips=tracks.filter(t=>!t.hidden).flatMap(t=>t.clips.filter(c=>c.type!=='audio'&&playhead>=c.start&&playhead<c.start+c.duration).map(c=>({clip:c,track:t})))
 const selected=tracks.flatMap(t=>t.clips.map(c=>({clip:c,track:t}))).find(x=>x.clip.client_id===clipId)
 const locked=!!selected&&(!!selected.clip.locked||selected.track.locked)
 const canCrop=!!selected&&!locked&&(selected.clip.type==='image'||selected.clip.type==='video')
 const canCut=!!selected&&!locked&&playhead>selected.clip.start+MIN_CLIP&&playhead<selected.clip.start+selected.clip.duration-MIN_CLIP
 function pick(id:string,trackId:string){useEditor.getState().selectClip(id);useEditor.getState().selectTrack(trackId);setShowObjects(false)}
 return <div className="flex h-11 min-w-0 shrink-0 items-center gap-2 overflow-visible px-1" aria-label="Editor and preview toolbar">
   <div className="flex shrink-0 items-center gap-1 border-r border-white/10 pr-2">
     <button onClick={undo} disabled={!past.length} title="Undo" aria-label="Undo" className="rounded-md p-1.5 hover:bg-cl-panel-2"><Undo2 size={16}/></button>
     <button onClick={redo} disabled={!future.length} title="Redo" aria-label="Redo" className="rounded-md p-1.5 hover:bg-cl-panel-2"><Redo2 size={16}/></button>
     <button title="Add text" onClick={addText} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-cl-muted hover:bg-cl-panel-2 hover:text-white"><Plus size={15}/>Text</button>
   </div>
   <span className="shrink-0 text-[11px] font-bold text-[#d9c5f6]">Preview</span>
   <div className="relative shrink-0">
     <button aria-label="Choose preview object" aria-expanded={showObjects} title="Select objects visible at the playhead" onClick={()=>setShowObjects(v=>!v)} className="flex max-w-36 items-center gap-1 rounded-md border border-white/10 bg-cl-panel-2 px-2 py-1.5 text-[10px] text-white">
       <span className="max-w-22 truncate">{selected?.clip.name??'Objects'}</span><ChevronDown size={12}/>
     </button>
     {showObjects&&<div className="absolute left-0 top-full z-[80] mt-1 w-60 max-h-52 overflow-y-auto rounded-lg border border-[#45404b] bg-[#25262a] p-1 shadow-xl">
       {clips.length?clips.map(({clip,track})=><button key={clip.client_id} className="flex w-full items-center justify-between gap-2 rounded p-2 text-left text-xs hover:bg-white/10" onClick={()=>pick(clip.client_id,track.client_id)}><span className="truncate">{clip.name}</span><small className="text-cl-muted">{clip.type}</small></button>):<p className="p-2 text-xs text-cl-muted">No object at this time.</p>}
       {selected&&!clips.some(x=>x.clip.client_id===selected.clip.client_id)&&<button className="w-full rounded p-2 text-left text-xs text-[#cda8fa] hover:bg-white/10" onClick={()=>{useEditor.getState().setPlayhead(selected.clip.start+Math.min(.02,selected.clip.duration/4));setShowObjects(false)}}>Go to selected clip</button>}
     </div>}
   </div>
   <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-white/10 bg-[#1e2024] px-1 py-0.5" role="toolbar" aria-label="Preview transform tools">
     {tools.map(({id,label,icon:Icon})=><button key={id} aria-label={`${label} object`} aria-pressed={tool===id} title={`${label} — ${id==='crop'?'select an image/video, then drag the green crop edges':'drag the object in Preview'}`} onClick={()=>{setTool(id);if(id==='crop'&&selected&&!(playhead>=selected.clip.start&&playhead<selected.clip.start+selected.clip.duration))useEditor.getState().setPlayhead(selected.clip.start+Math.min(.02,selected.clip.duration/4))}} disabled={id==='crop'&&!canCrop} className={`flex shrink-0 items-center gap-1 rounded p-1.5 text-[11px] ${tool===id?'bg-[#683e99] text-white':'text-[#aeb3b9] hover:bg-white/10 hover:text-white'}`}><Icon size={15}/><span className="hidden 2xl:inline">{label}</span></button>)}
   </div>
   <button type="button" disabled={!canCut} aria-label="Cut selected clip at playhead" title="Cut / Split selected clip at playhead" onClick={()=>{if(selected)useEditor.getState().splitClip(selected.clip.client_id,playhead)}} className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-cl-muted hover:bg-cl-panel-2 hover:text-white"><Scissors size={15}/>Cut</button>
   <span className="ml-auto hidden shrink-0 text-[10px] tabular-nums text-cl-muted xl:block">{project.width}×{project.height}</span>
   <button onClick={onSave} title="Save" aria-label="Save project" className="shrink-0 rounded-md p-1.5 hover:bg-cl-panel-2"><Save size={17}/></button>
   <button disabled title="FFmpeg export is not implemented" className="flex shrink-0 items-center gap-1 rounded-md bg-white px-2 py-1.5 text-[11px] font-bold text-black"><Download size={14}/><span className="hidden 2xl:inline">Export soon</span></button>
 </div>
}
