import { useEffect, useMemo, useRef, useState, type PointerEvent, type CSSProperties, type RefObject } from 'react'
import { Aperture, Pause, Play, Volume2 } from 'lucide-react'
import { useEditor } from '../../../stores/editorStore'
import { fileUrl, formatTime } from '../../../lib/api'
import type { Clip, ClipProperties, Project } from '../../../types'

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v))
function applyVolume(el: HTMLMediaElement | null, clip: Clip, muted: boolean) {
  if (!el) return
  el.muted=muted || !!clip.props?.audio_muted || !!clip.props?.reversed
  el.volume=clamp(clip.props?.volume??1,0,1)
}
function useSyncTime(ref: RefObject<HTMLMediaElement|null>, clip:Clip, playhead:number,playing:boolean,muted:boolean){
  useEffect(()=>{
    const el=ref.current
    if(!el)return
    const relative=clamp(playhead-clip.start,0,clip.duration)
    const reverse=!!clip.props?.reversed
    const target=Math.max(0, clip.source_offset+(reverse?Math.max(0,clip.duration-relative):relative))
    if(Number.isFinite(target)&&Math.abs(el.currentTime-target)>.2){try {el.currentTime=target}catch{ /* media metadata not loaded */ }}
    applyVolume(el,clip,muted)
    if(playing&&!reverse)void el.play().catch(()=>{})
    else el.pause()
  },[ref,clip,playhead,playing,muted])
}
function VideoSource({clip,playhead,playing,muted}:{clip:Clip;playhead:number;playing:boolean;muted:boolean}){
  const ref=useRef<HTMLVideoElement>(null)
  useSyncTime(ref,clip,playhead,playing,muted)
  return clip.media_id?<video ref={ref} src={fileUrl(clip.media_id)} className="pointer-events-none h-full w-full object-contain" playsInline preload="auto"/>:null
}
function AudioSource({clip,playhead,playing}:{clip:Clip;playhead:number;playing:boolean}){
  const ref=useRef<HTMLAudioElement>(null)
  useSyncTime(ref,clip,playhead,playing,false)
  return clip.media_id?<audio ref={ref} src={fileUrl(clip.media_id)} preload="auto"/>:null
}
type Gesture={ id:string; mode:'move'|'resize'|'rotate'|'scale'; startX:number; startY:number; start:Required<Pick<ClipProperties,'x'|'y'|'width'|'height'|'rotation'|'scale'>>; centerX:number;centerY:number }
function VisualObject({clip,muted,playhead,playing}:{clip:Clip;muted:boolean;playhead:number;playing:boolean}){
 const select=useEditor(s=>s.selectClip), patchProps=useEditor(s=>s.patchProps), setPlaying=useEditor(s=>s.setPlaying)
 const selected=useEditor(s=>s.selectedClipId===clip.client_id)
 const trackLocked=useEditor(s=>s.tracks.some(t=>t.locked&&t.clips.some(c=>c.client_id===clip.client_id)))
 const parent=useRef<HTMLDivElement>(null)
 const gesture=useRef<Gesture|null>(null)
 const [draft,setDraft]=useState<ClipProperties|null>(null)
 const props={x:clip.type==='text'?20:0,y:clip.type==='text'?35:0,width:clip.type==='text'?60:100,height:clip.type==='text'?22:100,rotation:0,scale:1,opacity:1, ...clip.props, ...draft}
 const frameStyle:CSSProperties={left:`${props.x}%`,top:`${props.y}%`,width:`${props.width}%`,height:`${props.height}%`,opacity:props.opacity,transform:`rotate(${props.rotation}deg) scale(${(props.flip_x?-1:1)*props.scale},${(props.flip_y?-1:1)*props.scale})`,transformOrigin:'center center'}
 function down(event:PointerEvent<HTMLDivElement>){
    event.stopPropagation()
    select(clip.client_id)
    if(trackLocked||event.button!==0)return
    setPlaying(false)
    const handle=(event.target as HTMLElement).closest('[data-handle]')?.getAttribute('data-handle')
    const mode=handle==='resize'?'resize':handle==='rotate'?'rotate':handle==='scale'?'scale':'move'
    const canvas=parent.current?.parentElement
    if(!canvas)return
    const box=canvas.getBoundingClientRect()
    const cx=box.left+(props.x+props.width/2)*box.width/100,cy=box.top+(props.y+props.height/2)*box.height/100
    gesture.current={id:clip.client_id,mode,startX:event.clientX,startY:event.clientY,start:{x:props.x,y:props.y,width:props.width,height:props.height,rotation:props.rotation,scale:props.scale},centerX:cx,centerY:cy}
    event.currentTarget.setPointerCapture(event.pointerId)
 }
 function move(event:PointerEvent<HTMLDivElement>){
   const g=gesture.current, canvas=parent.current?.parentElement
   if(!g||!canvas)return
   const rect=canvas.getBoundingClientRect()
   const dx=(event.clientX-g.startX)/rect.width*100,dy=(event.clientY-g.startY)/rect.height*100
   if(g.mode==='move')setDraft({x:Math.round(clamp(g.start.x+dx,-500,500)*10)/10,y:Math.round(clamp(g.start.y+dy,-500,500)*10)/10})
   else if(g.mode==='resize')setDraft({width:Math.round(clamp(g.start.width+dx,1,500)*10)/10,height:Math.round(clamp(g.start.height+dy,1,500)*10)/10})
   else if(g.mode==='scale')setDraft({scale:Math.round(clamp(g.start.scale+(event.clientX-g.startX)/Math.max(rect.width,80)*3,.1,10)*100)/100})
   else {const first=Math.atan2(g.startY-g.centerY,g.startX-g.centerX),last=Math.atan2(event.clientY-g.centerY,event.clientX-g.centerX);setDraft({rotation:Math.round(g.start.rotation+(last-first)*180/Math.PI)})}
 }
 function up(event:PointerEvent<HTMLDivElement>){
   if(!gesture.current)return
   gesture.current=null
   if(draft){patchProps(clip.client_id,draft);setDraft(null)}
   if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)
 }
 return <div ref={parent} data-preview-object className={`absolute touch-none select-none ${selected?'z-20':'z-10'} ${trackLocked?'cursor-not-allowed':'cursor-move'}`} style={frameStyle} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{gesture.current=null;setDraft(null)}} onClick={e=>e.stopPropagation()}>
   <div className="pointer-events-none h-full w-full overflow-hidden">
     {clip.type==='video'?<VideoSource clip={clip} playhead={playhead} playing={playing} muted={muted}/>:clip.type==='image'&&clip.media_id?<img className="h-full w-full object-contain" src={fileUrl(clip.media_id)} alt={clip.name} draggable={false}/>:clip.type==='text'?<div className="flex h-full w-full items-center justify-center whitespace-pre-wrap p-2 text-center font-display text-[clamp(10px,2.5vw,32px)] font-bold leading-tight" style={{color:clip.color}}>{clip.text||clip.name}</div>:null}
   </div>
   {selected&&<><div className="pointer-events-none absolute inset-0 border-2 border-[#b88afd] shadow-[0_0_0_1px_#ffffff88]"/>
     <div data-handle="resize" aria-label="Resize object" title="Drag to resize width and height" className="absolute right-1 bottom-1 z-30 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-[#5f3c9b] bg-white"/>
     <div data-handle="rotate" aria-label="Rotate object" title="Drag to rotate" className="absolute top-2 left-1/2 z-30 h-4 w-4 -translate-x-1/2 cursor-crosshair rounded-full border-2 border-[#5f3c9b] bg-white before:absolute before:top-3 before:left-[5px] before:h-4 before:w-[2px] before:bg-[#b88afd]"/>
     <div data-handle="scale" aria-label="Scale object" title="Drag to scale proportionally" className="absolute bottom-1 left-1 z-30 h-4 w-4 cursor-nesw-resize rounded-full border-2 border-[#5f3c9b] bg-[#9df0e3]"/>
     <div className="pointer-events-none absolute -top-6 left-0 max-w-40 truncate rounded bg-[#24252a] px-1.5 py-0.5 text-[9px] text-white">{clip.name}</div>
   </>}
 </div>
}

export function PreviewPanel({ project }: { project: Project }) {
  const tracks = useEditor(s => s.tracks),playhead=useEditor(s=>s.playhead),setPlayhead=useEditor(s=>s.setPlayhead)
  const playing=useEditor(s=>s.playing),setPlaying=useEditor(s=>s.setPlaying),selectClip=useEditor(s=>s.selectClip)
  const active=useMemo(()=>{
    const atTime=(clip:Clip)=>clip.start<=playhead&&clip.start+clip.duration>playhead
    const visible=tracks.filter(t=>!t.hidden).flatMap(t=>t.clips.filter(c=>c.type!=='audio'&&atTime(c)).map(clip=>({clip,muted:t.muted})))
    const audio=tracks.filter(t=>!t.hidden&&!t.muted).flatMap(t=>t.clips.filter(c=>c.type==='audio'&&atTime(c)))
    const backdrop=[...tracks].reverse().find(t=>!t.hidden&&t.background_color&&t.background_color!=='#101214')?.background_color??'#08090a'
    return {visible,audio,backdrop}
  },[tracks,playhead])
  const total=Math.max(30,...tracks.flatMap(t=>t.clips.map(c=>c.start+c.duration)))
  return <section className="flex h-full min-h-0 min-w-0 flex-col items-center justify-center gap-2 overflow-hidden bg-[#141618] p-2">
    <div className="flex min-h-0 min-w-0 w-full flex-1 items-center justify-center overflow-hidden">
      <div data-preview-canvas onClick={()=>selectClip(null)} className="relative h-full max-h-full max-w-full shrink overflow-hidden rounded-md" style={{aspectRatio:`${project.width}/${project.height}`,height:'100%',background:active.backdrop}}>
        {!active.visible.length&&<div className="pointer-events-none grid h-full w-full place-items-center text-[#5a5f66]"><div className="grid justify-items-center gap-2"><Aperture size={36}/><p className="text-xs">Preview canvas</p></div></div>}
        {active.visible.map(({clip,muted})=><VisualObject key={clip.client_id} clip={clip} muted={muted} playhead={playhead} playing={playing}/>)}
      </div>
      {active.audio.map(clip=><AudioSource key={clip.client_id} clip={clip} playhead={playhead} playing={playing}/>)}
    </div>
    <div className="flex w-full min-w-0 max-w-190 shrink-0 items-center gap-2 rounded-lg bg-[#24272a] px-2.5 py-2">
      <span className="shrink-0 rounded-md bg-[#303336] px-2 py-1.5 text-[10px] font-bold">{project.width}:{project.height}</span>
      <button aria-label={playing?'Pause':'Play'} onClick={()=>setPlaying(!playing)} className="text-white">{playing?<Pause size={20}/>:<Play size={20}/>}</button>
      <span className="min-w-18 text-[10px] text-[#afb4b9]">{formatTime(playhead)} / {formatTime(total)}</span>
      <input className="min-w-0 flex-1" type="range" min={0} max={total} step={.1} value={Math.min(total,playhead)} onChange={e=>setPlayhead(Number(e.target.value))}/>
      <Volume2 size={17} className="text-cl-muted"/>
    </div>
  </section>
}
