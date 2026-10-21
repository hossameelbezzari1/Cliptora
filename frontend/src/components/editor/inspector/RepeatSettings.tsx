import { useMemo } from 'react'
import { Link2, Repeat2, RotateCcw } from 'lucide-react'
import { repeatOccurrences, type RepeatRules } from '../../../lib/repeat'
import { useEditor, MAX_TIME } from '../../../stores/editorStore'
import type { Clip, Track } from '../../../types'
import { formatTime } from '../../../lib/api'

const input = 'w-full min-w-0 rounded-lg border border-white/10 bg-[#272a2e] px-2.5 py-2 text-xs text-white focus:border-[#aa77f4]'
const DEFAULT:RepeatRules={mode:'none',interval:20,offset:0,until:'project_end',count:10}

export function RepeatSettings({clip, tracks}:{clip:Clip;tracks:Track[]}) {
  const patchProps=useEditor(s=>s.patchProps)
  const playhead=useEditor(s=>s.playhead)
  const setPlayhead=useEditor(s=>s.setPlayhead)
  const clips=useMemo(()=>tracks.flatMap(t=>t.clips),[tracks])
  const targets=useMemo(()=>clips.filter(other=>other.client_id!==clip.client_id),[clips,clip.client_id])
  const saved=clip.props?.repeat
  const rules={...DEFAULT,...saved}
  const projectEnd=Math.max(60,...clips.map(c=>c.start+c.duration))
  const target=targets.find(c=>c.client_id===rules.targetId)
  const invalidTarget=!!rules.targetId&&!target
  const appearances=useMemo(()=>repeatOccurrences(
    {id:clip.client_id,start:clip.start,duration:clip.duration},
    rules.mode==='none'?undefined:rules,
    clips.map(c=>({id:c.client_id,start:c.start,duration:c.duration})),projectEnd,250
  ),[clip,clips,rules.mode,rules.interval,rules.offset,rules.until,rules.targetId,rules.count,rules.endTime,rules.appearanceDuration,projectEnd])
  const update=(part:Partial<RepeatRules>)=>patchProps(clip.client_id,{repeat:{...rules,...part}})
  const numeric=(name:string,value:number,min:number,max:number,step:number,change:(n:number)=>void)=><label className="grid min-w-0 gap-1.5 text-[11px] text-cl-muted">{name}<input type="number" className={input} min={min} max={max} step={step} value={value} onChange={event=>{
    const next=Number(event.target.value)
    if(Number.isFinite(next))change(Math.max(min,Math.min(max,next)))
  }}/></label>
  return <section className="grid gap-3 border-t border-white/10 pt-3" data-repeat-settings>
    <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-1.5 text-xs font-semibold text-white"><Repeat2 size={15} className="text-[#af81f6]"/>Repeat / Linked Element</h3>
      {rules.mode!=='none'&&<button type="button" title="Disable repeat" onClick={()=>update({mode:'none'})} className="rounded p-1 text-cl-muted hover:text-white"><RotateCcw size={14}/></button>}
    </div>
    <label className="grid gap-1 text-[11px] text-cl-muted">Repeat mode<select data-clip-field="repeat_mode" className={input} value={rules.mode} onChange={event=>update({mode:event.target.value as RepeatRules['mode']})}>
      <option value="none">Off (single instance)</option><option value="interval">Repeat every interval</option><option value="loop">Loop continuously</option>
    </select></label>
    {rules.mode!=='none'&&<>
      <label className="grid gap-1 text-[11px] text-cl-muted"><span className="flex items-center gap-1"><Link2 size={12}/>Link to element (optional)</span>
        <select data-clip-field="repeat_target" className={input} value={rules.targetId||''} onChange={event=>update({targetId:event.target.value||undefined})}>
          <option value="">Own clip / project</option>
          {targets.map(other=><option key={other.client_id} value={other.client_id}>{other.name} — {formatTime(other.start)} / {formatTime(other.duration)}</option>)}
          {invalidTarget&&<option value={rules.targetId}>Missing element ({rules.targetId})</option>}
        </select>
      </label>
      {invalidTarget&&<p role="alert" className="rounded bg-red-900/40 p-2 text-[11px] text-red-200">Linked element was removed or is unavailable. Select another target.</p>}
      <div className="grid grid-cols-2 gap-2">
        {rules.mode==='interval'&&numeric('Every (seconds)',rules.interval,0.1,MAX_TIME,0.1,n=>update({interval:n}))}
        {numeric('Start offset (seconds)',rules.offset,-MAX_TIME,MAX_TIME,0.1,n=>update({offset:n}))}
        {numeric('Each appearance (s)',rules.appearanceDuration??clip.duration,0.1,MAX_TIME,0.1,n=>update({appearanceDuration:n}))}
      </div>
      <label className="grid gap-1 text-[11px] text-cl-muted">Repeat until<select className={input} value={rules.until} onChange={event=>update({until:event.target.value as RepeatRules['until']})}>
        <option value="project_end">End of project</option><option value="target_end" disabled={!rules.targetId}>Linked element ends</option>
        <option value="count">Number of occurrences</option><option value="time">Specific time</option>
      </select></label>
      {rules.until==='count'&&numeric('Repeat count',rules.count??10,1,1000,1,n=>update({count:Math.floor(n)}))}
      {rules.until==='time'&&numeric('End at (seconds)',rules.endTime??projectEnd,0,MAX_TIME,0.1,n=>update({endTime:n}))}
      <div className="rounded-lg bg-[#20232a] p-2.5 text-[11px] text-[#adb5c0]">
        <strong className="text-[#dabfff]">{appearances.length}{appearances.length>=250?'+':''} appearances</strong>
        <span className="ml-1">calculated in the current timeline</span>
        {appearances.length>0&&<div className="mt-2 flex flex-wrap gap-1">{appearances.slice(0,8).map((occ,i)=><button type="button" key={occ.id} title="Move playhead to occurrence" onClick={()=>setPlayhead(occ.start)} className={`rounded border border-[#51426b] px-1.5 py-1 hover:bg-[#533c78] ${playhead>=occ.start&&playhead<occ.start+occ.duration?'bg-[#67458d] text-white':''}`}>{i+1}: {formatTime(occ.start)}</button>)}</div>}
        {appearances.length===0&&<p className="mt-1 text-amber-300">No visible occurrences. Check target, offset and end condition.</p>}
      </div>
      <p className="text-[10px] leading-4 text-cl-muted">Instances follow their linked clip's start/end. Changes save with Clip Settings. Repeated instances are previewed and shown as timeline guides.</p>
    </>}
  </section>
}
