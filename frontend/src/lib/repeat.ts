export type RepeatRules = {mode:'none'|'interval'|'loop'; interval:number; offset:number; until:'target_end'|'project_end'|'count'|'time'; targetId?:string; count?:number; endTime?:number; appearanceDuration?:number}
export type Timing = {id:string;start:number;duration:number}
export function repeatOccurrences(base:Timing, rules:RepeatRules | undefined, targets:Timing[], projectEnd:number, limit=1000):Timing[] {
  if (!rules || rules.mode === 'none') return [base]
  const target=rules.targetId ? targets.find(c=>c.id===rules.targetId) : undefined
  if (rules.targetId && !target) return []
  const start=(target?.start ?? base.start) + (rules.offset || 0)
  const end=Math.min(14400, rules.until==='target_end' ? (target ? target.start + target.duration : base.start+base.duration) : rules.until==='time' ? (rules.endTime??projectEnd) : rules.until==='count' ? 14400 : projectEnd)
  const every=rules.mode==='loop' ? base.duration : rules.interval
  const duration=rules.appearanceDuration ?? base.duration
  if (!Number.isFinite(every)||every<=0||!Number.isFinite(duration)||duration<=0||!Number.isFinite(start)) return []
  const count= rules.until==='count' ? Math.max(0,Math.floor(rules.count??0)) : limit
  const output:Timing[]=[]
  for(let i=0;i<Math.min(limit,count);i++){
    const at=start+i*every
    if (at >= end || at < 0) break
    const visible=Math.min(duration,end-at)
    if (visible>0) output.push({id:`${base.id}:${i}`,start:at,duration:visible})
  }
  return output
}


/** Timeline horizon including finite/time-bounded repeats; project_end never extends itself. */
export function effectiveTimelineEnd(clips: Array<{client_id:string;start:number;duration:number;props?:{repeat?:RepeatRules}}>,minimum=60):number {
  const horizon=Math.max(minimum,...clips.map(c=>c.start+c.duration))
  let end=horizon
  for(const clip of clips){
    const rule=clip.props?.repeat
    if(!rule || rule.mode==='none')continue
    if(rule.targetId && !clips.some(c=>c.client_id===rule.targetId))continue
    if(rule.until==='time' && Number.isFinite(rule.endTime)) end=Math.max(end,rule.endTime??0)
    if(rule.until==='count'){
      const count=Math.min(1000,Math.max(0,Math.floor(rule.count??0)))
      const every=rule.mode==='loop'?clip.duration:rule.interval
      const duration=rule.appearanceDuration??clip.duration
      const target=clips.find(c=>c.client_id===rule.targetId)
      const start=(target?.start??clip.start)+(rule.offset||0)
      if(count>0&&Number.isFinite(every)&&every>0&&Number.isFinite(start)&&Number.isFinite(duration)&&duration>0){
        end=Math.max(end,start+(count-1)*every+duration)
      }
    }
  }
  return Math.min(14400,end)
}
