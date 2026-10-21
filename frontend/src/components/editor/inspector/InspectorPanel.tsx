import { useEditor } from '../../../stores/editorStore'
import { MousePointer2, Trash2, RotateCcw, FlipHorizontal, FlipVertical } from 'lucide-react'
import type { ClipProperties } from '../../../types'

const clamp = (n:number,min:number,max:number)=>Math.max(min,Math.min(max,n))
const propertyDefaults: Required<Omit<ClipProperties,'attached_to'>> = { x:0, y:0, width:100, height:100, rotation:0, scale:1, opacity:1, flip_x:false, flip_y:false, reversed:false, audio_muted:false, volume:1, crop_left:0, crop_right:0, crop_top:0, crop_bottom:0 }

export function InspectorPanel(){
 const tracks=useEditor(s=>s.tracks), selected=useEditor(s=>s.selectedClipId), patch=useEditor(s=>s.patchClip), patchProps=useEditor(s=>s.patchProps), remove=useEditor(s=>s.removeClip), split=useEditor(s=>s.splitClip), playhead=useEditor(s=>s.playhead)
 const found=tracks.flatMap(t=>t.clips).find(c=>c.client_id===selected)
 const fieldStyle='w-full min-w-0 rounded-lg border border-white/10 bg-[#272a2e] px-2.5 py-2 text-xs text-white focus:border-cl-purple'
 const row='grid grid-cols-2 gap-2.5'
 const input=(label:string,key:keyof ClipProperties,lo:number,hi:number,step:number)=>{
    if(!found)return null
    const fallback=propertyDefaults[key as keyof typeof propertyDefaults] as number
    return <label className="grid min-w-0 gap-1.5 text-[11px] text-cl-muted" key={key}>{label}
      <input data-clip-field={key} type="number" className={fieldStyle} step={step} min={lo} max={hi} value={found.props?.[key] as number ?? fallback}
        onChange={e=>{
          const cropKey=key==='crop_left'||key==='crop_right'||key==='crop_top'||key==='crop_bottom'
          const opposite=key==='crop_left'?'crop_right':key==='crop_right'?'crop_left':key==='crop_top'?'crop_bottom':'crop_top'
          const maxValue=cropKey?Math.min(hi,95-(found.props?.[opposite] as number ?? 0)):hi
          patchProps(found.client_id,{[key]:clamp(Number(e.target.value)||0,lo,maxValue)})
        }}/>
    </label>
 }
 const timing=(label:string,key:'start'|'duration'|'end'|'source_offset')=>{
    if(!found)return null
    const value=key==='end'?found.start+found.duration:found[key]
    return <label className="grid min-w-0 gap-1.5 text-[11px] text-cl-muted">{label}
      <input data-clip-field={key} className={fieldStyle} type="number" min={0} max={14400} step={0.01} value={Math.round(value*100)/100}
        onChange={e=>{
          const v=Math.max(0,Number(e.target.value)||0)
          if(key==='end')patch(found.client_id,{duration:Math.max(.1,v-found.start)})
          else patch(found.client_id,{[key]:key==='duration'?Math.max(.1,v):v})
        }}/>
    </label>
 }
 return <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto bg-cl-panel p-3.5">
  <h2 className="mb-4 shrink-0 font-display text-base font-bold">{found?'Clip Settings':'Properties'}</h2>
  {found?<div className="grid content-start gap-4 pb-8">
   <label className="grid gap-1.5 text-[11px] text-cl-muted">Name<input data-clip-field="name" className={fieldStyle} maxLength={160} value={found.name} onChange={e=>patch(found.client_id,{name:e.target.value})}/></label>
   <section className="grid gap-2"><h3 className="text-xs font-semibold text-white">Timing</h3><div className={row}>{timing('Start (s)','start')}{timing('End (s)','end')}{timing('Duration (s)','duration')}{found.type!=='text'&&timing('Source offset (s)','source_offset')}</div><button type="button" onClick={()=>split(found.client_id,playhead)} className="w-full rounded-lg bg-cl-panel-2 px-3 py-2 text-left text-[11px] hover:bg-[#363943]">Split at playhead</button></section>
   {found.type!=='audio'&&<><section className="grid gap-2"><h3 className="text-xs font-semibold text-white">Transform</h3><div className={row}>{input('X (%)','x',-500,500,.1)}{input('Y (%)','y',-500,500,.1)}{input('Width (%)','width',1,500,.1)}{input('Height (%)','height',1,500,.1)}{input('Rotation (°)','rotation',-3600,3600,1)}{input('Scale','scale',.1,10,.05)}</div><div className="flex gap-2"><button title="Flip horizontal" className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-cl-panel-2 p-2 text-[11px]" onClick={()=>patchProps(found.client_id,{flip_x:!found.props?.flip_x})}><FlipHorizontal size={15}/>Flip X</button><button title="Flip vertical" className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-cl-panel-2 p-2 text-[11px]" onClick={()=>patchProps(found.client_id,{flip_y:!found.props?.flip_y})}><FlipVertical size={15}/>Flip Y</button></div><button className="flex items-center justify-center gap-2 rounded-lg bg-cl-panel-2 p-2 text-xs" onClick={()=>patchProps(found.client_id,{x:0,y:0,width:100,height:100,rotation:0,scale:1,flip_x:false,flip_y:false})}><RotateCcw size={14}/>Reset transform</button></section>
   {(found.type==='image'||found.type==='video')&&<section className="grid gap-2">
     <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold text-white">Crop image / video</h3><button type="button" onClick={()=>{useEditor.getState().setPreviewTool('crop');useEditor.getState().setPlayhead(found.start+Math.min(.02,found.duration/4))}} className="rounded bg-[#45305b] px-2 py-1 text-[10px] text-white">Edit on canvas</button></div>
     <p className="text-[10px] text-cl-muted">Crop hides source edges, without changing the clip timeline duration.</p>
     <div className={row}>{input('Left (%)','crop_left',0,95,1)}{input('Right (%)','crop_right',0,95,1)}{input('Top (%)','crop_top',0,95,1)}{input('Bottom (%)','crop_bottom',0,95,1)}</div>
     <button type="button" onClick={()=>patchProps(found.client_id,{crop_left:0,crop_right:0,crop_top:0,crop_bottom:0})} className="rounded-lg bg-cl-panel-2 p-2 text-[11px]">Reset crop</button>
   </section>}
   <section className="grid gap-2"><h3 className="text-xs font-semibold text-white">Appearance</h3>{input('Opacity','opacity',0,1,.05)}{found.type==='text'&&<><label className="text-[11px] text-cl-muted">Text<textarea className={`${fieldStyle} mt-1 min-h-20`} value={found.text??''} onChange={e=>patch(found.client_id,{text:e.target.value})}/></label><label className="flex items-center gap-2 text-xs text-cl-muted">Text color<input type="color" value={found.color} onChange={e=>patch(found.client_id,{color:e.target.value})}/></label></>}</section></>}
   {(found.type==='video'||found.type==='audio')&&<section className="grid gap-2"><h3 className="text-xs font-semibold text-white">Sound & Playback</h3>{input('Volume','volume',0,1,.05)}<label className="flex items-center gap-2 text-[11px] text-cl-muted"><input type="checkbox" checked={!!found.props?.audio_muted} onChange={e=>patchProps(found.client_id,{audio_muted:e.target.checked})}/>Mute this clip</label>{found.type==='video'&&<label className="flex items-center gap-2 text-[11px] text-cl-muted"><input type="checkbox" checked={!!found.props?.reversed} onChange={e=>patchProps(found.client_id,{reversed:e.target.checked})}/>Reverse video frames in preview (silent)</label>}</section>}
   <button className="flex items-center justify-center gap-2 rounded-lg bg-[#4c252b] p-2.5 text-xs text-[#ff9c9c] hover:bg-[#63313a]" onClick={()=>remove(found.client_id)}><Trash2 size={15}/>Delete clip</button>
  </div>:<div className="grid flex-1 place-items-center text-center"><div className="text-cl-muted"><MousePointer2 className="mx-auto mb-3" size={28}/><h3 className="font-bold text-white">Nothing selected</h3><p className="mt-2 text-xs leading-5">Select a clip in Timeline or Preview to edit position, size, timing and appearance.</p></div></div>}
 </aside>
}
