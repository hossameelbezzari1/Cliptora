import { useEffect, useState } from 'react'
import { Aperture, ChevronDown, Crop, Pause, Play, SlidersHorizontal, Square, Volume2 } from 'lucide-react'
import { useEditor } from '../state/editorStore'
import { formatTime } from '../../../lib/time'

export function Preview(){
  const {playhead,setPlayhead,demo}=useEditor(); const [playing,setPlaying]=useState(false)
  useEffect(()=>{if(!playing || !demo)return;const timer=window.setInterval(()=>useEditor.setState(s=>({playhead:Math.min(90,s.playhead+0.2)})),200);return()=>window.clearInterval(timer)},[playing,demo])
  return <section className="preview-area"><div className="preview-frame">{demo?<img src="/assets/planet-demo.png" alt="Demo project preview"/>:<div className="blank-preview"><Aperture/><span>Preview canvas</span></div>}{demo&&<div className="selected-title"><i/><i/><i/><i/><strong>Law Of<br/>Conservation Of<br/>Energy</strong></div>}{demo&&<span className="demo-chip">DEMO PREVIEW</span>}</div><div className="preview-controls"><button className="ratio">16 : 9 <ChevronDown/></button><div className="play-controls"><button><Volume2/></button><button onClick={()=>setPlaying(!playing)} disabled={!demo} title={!demo?"Playback arrives with real media support":"Play demo"}>{playing?<Pause/>:<Play/>}</button><span>{formatTime(playhead)} / 01:30</span><input type="range" min="0" max="90" disabled={!demo} value={playhead} onChange={e=>setPlayhead(+e.target.value)}/></div><div className="preview-actions"><button disabled title="Crop: coming soon"><Crop/></button><button disabled title="Adjustments: coming soon"><SlidersHorizontal/></button><button disabled title="Fullscreen: coming soon"><Square/></button></div></div></section>
}
