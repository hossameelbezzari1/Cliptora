import { create } from 'zustand'
import type { Track,Clip,MediaAsset,Timeline } from '../types'
import { uid } from '../lib/api'

type Store={
 projectId:number|null;revision:number;tracks:Track[];media:MediaAsset[];playhead:number;playing:boolean;selectedClipId:string|null;selectedTrackId:string|null;dirty:number;past:Track[][];future:Track[][];
 hydrate:(projectId:number,timeline:Timeline)=>void;setMedia:(media:MediaAsset[])=>void;setPlayhead:(time:number)=>void;setPlaying:(yes:boolean)=>void;selectClip:(id:string|null)=>void;selectTrack:(id:string|null)=>void;
 changeTracks:(f:(tracks:Track[])=>Track[])=>void;addTrack:(type:Track['type'])=>void;toggleTrack:(id:string,key:'hidden'|'muted'|'locked')=>void;removeTrack:(id:string)=>void;
 addMediaClip:(media:MediaAsset,duration:number)=>void;addTextClip:()=>void;patchClip:(id:string,patch:Partial<Clip>)=>void;removeClip:(id:string)=>void;
 undo:()=>void;redo:()=>void;markSaved:(revision:number)=>void;
}
const label=(type:Track['type'])=>type==='video'?'MEDIA':type==='audio'?'AUDIO':'TEXT'
const normalize=(tracks:Track[])=>tracks.map((t,i)=>({...t,position:i}))
export const useEditor=create<Store>((set,get)=>({
 projectId:null,revision:1,tracks:[],media:[],playhead:0,playing:false,selectedClipId:null,selectedTrackId:null,dirty:0,past:[],future:[],
 hydrate:(projectId,timeline)=>set({projectId,revision:timeline.revision,tracks:timeline.tracks,playhead:0,playing:false,selectedClipId:null,selectedTrackId:null,dirty:0,past:[],future:[]}),
 setMedia:media=>set({media}),setPlayhead:playhead=>set({playhead:Math.max(0,playhead)}),setPlaying:playing=>set({playing}),selectClip:selectedClipId=>set({selectedClipId}),selectTrack:selectedTrackId=>set({selectedTrackId}),
 changeTracks:fn=>set(s=>({tracks:normalize(fn(s.tracks)),past:[...s.past.slice(-29),structuredClone(s.tracks)],future:[],dirty:s.dirty+1})),
 addTrack:type=>get().changeTracks(tracks=>[...tracks,{client_id:uid(),name:`${label(type)} ${tracks.filter(x=>x.type===type).length+1}`,type,position:tracks.length,hidden:false,muted:false,locked:false,clips:[]}]),
 toggleTrack:(id,key)=>get().changeTracks(tracks=>tracks.map(t=>t.client_id===id?{...t,[key]:!t[key]}:t)),
 removeTrack:id=>{get().changeTracks(tracks=>tracks.filter(t=>t.client_id!==id));set({selectedTrackId:null,selectedClipId:null})},
 addMediaClip:(media,duration)=>{
   const type:Track['type']=media.kind==='audio'?'audio':'video';const tracks=get().tracks
   const existing=tracks.find(t=>t.type===type&&!t.locked);const id=existing?.client_id||uid()
   const start=existing?Math.max(0,...existing.clips.map(c=>c.start+c.duration)):0
   const clip:Clip={client_id:uid(),name:media.name,type:media.kind,media_id:media.id,start,duration:Math.min(Math.max(duration,.25),3600),source_offset:0,text:null,color:'#5bff93'}
   get().changeTracks(ts=>existing?ts.map(t=>t.client_id===id?{...t,clips:[...t.clips,clip]}:t):[...ts,{client_id:id,name:`MEDIA ${ts.filter(t=>t.type==='video').length+1}`.replace('MEDIA',label(type)),type,position:ts.length,hidden:false,muted:false,locked:false,clips:[clip]}])
   set({selectedClipId:clip.client_id,selectedTrackId:id,playhead:start})
 },
 addTextClip:()=>{const tracks=get().tracks;const existing=tracks.find(t=>t.type==='text'&&!t.locked);const id=existing?.client_id||uid();const start=get().playhead;const clip:Clip={client_id:uid(),name:'New text',type:'text',media_id:null,start,duration:5,source_offset:0,text:'Your text here',color:'#5bff93'};get().changeTracks(ts=>existing?ts.map(t=>t.client_id===id?{...t,clips:[...t.clips,clip]}:t):[...ts,{client_id:id,name:`TEXT ${ts.filter(t=>t.type==='text').length+1}`,type:'text',position:ts.length,hidden:false,muted:false,locked:false,clips:[clip]}]);set({selectedClipId:clip.client_id,selectedTrackId:id})},
 patchClip:(id,patch)=>get().changeTracks(tracks=>tracks.map(t=>({...t,clips:t.clips.map(c=>c.client_id===id?{...c,...patch}:c)}))),
 removeClip:id=>{get().changeTracks(tracks=>tracks.map(t=>({...t,clips:t.clips.filter(c=>c.client_id!==id)})));set({selectedClipId:null})},
 undo:()=>set(s=>s.past.length?{tracks:s.past[s.past.length-1],past:s.past.slice(0,-1),future:[structuredClone(s.tracks),...s.future],dirty:s.dirty+1}:{ }),
 redo:()=>set(s=>s.future.length?{tracks:s.future[0],future:s.future.slice(1),past:[...s.past,structuredClone(s.tracks)],dirty:s.dirty+1}:{ }),
 markSaved:revision=>set({revision}),
}))
