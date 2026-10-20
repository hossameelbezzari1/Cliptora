import type { Scene,Track,Timeline,MediaAsset,Clip } from '../../types'
import { uid } from '../../lib/api'
export const DEFAULT_INSTRUCTIONS='Select only the most meaningful scenes from the timestamped transcript. Use transcript text and timestamps ONLY. Do not assume visual information. Return accurate, non-overlapping chronological moments.'
export function buildPrompt(instructions:string,transcript:string){return `${instructions.trim()}

INPUT TRANSCRIPT:
${transcript.trim()}

Return ONLY valid JSON (no markdown) with this exact schema:
{"scenes":[{"start":0.0,"end":12.5,"reason":"Why this scene matters"}]}

Rules: timestamps are seconds from source, end > start, scenes sorted ascending, do not fabricate timestamps.`}
export function parseScenes(raw:string):Scene[]{const data:unknown=JSON.parse(raw);if(!data||typeof data!=='object'||!('scenes' in data)||!Array.isArray((data as {scenes:unknown}).scenes))throw Error('Expected JSON object containing a scenes array.')
 const scenes=(data as {scenes:unknown[]}).scenes.map((v,i)=>{if(!v||typeof v!=='object')throw Error(`Scene ${i+1} is invalid.`);const s=v as Record<string,unknown>;const start=Number(s.start);const end=Number(s.end);if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>14400)throw Error(`Scene ${i+1} has invalid start/end seconds.`);return {start,end,reason:typeof s.reason==='string'?s.reason:''}})
 if(!scenes.length||scenes.length>200)throw Error('Provide 1 to 200 valid scenes.')
 scenes.sort((a,b)=>a.start-b.start);for(let i=1;i<scenes.length;i++)if(scenes[i].start<scenes[i-1].end)throw Error('Scenes must not overlap.')
 return scenes}
export function applyScenes(timeline:Timeline,scenes:Scene[],video:MediaAsset):Timeline{
 const existing=[...timeline.tracks].reverse().find(t=>!t.locked)
 const trackId=existing?.client_id||uid()
 let offset=existing?Math.max(0,...existing.clips.map(c=>c.start+c.duration)):0
 const clips:Clip[]=scenes.map((scene,index)=>{const c:Clip={client_id:uid(),name:`Scene ${index+1}${scene.reason?' · '+scene.reason.slice(0,90):''}`,type:'video',media_id:video.id,text:null,color:'#5bff93',start:offset,duration:scene.end-scene.start,source_offset:scene.start};offset+=c.duration;return c})
 const tracks:Track[]=existing?timeline.tracks.map(t=>t.client_id===trackId?{...t,clips:[...t.clips,...clips]}:t):[...timeline.tracks,{client_id:trackId,name:`Layer ${timeline.tracks.length+1}`,type:'mixed',position:timeline.tracks.length,hidden:false,muted:false,locked:false,clips}]
 return {...timeline,tracks}
}
