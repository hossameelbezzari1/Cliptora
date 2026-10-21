import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
type Axis='left'|'right'|'horizontal'
type Props={left:ReactNode;center:ReactNode;right:ReactNode;timeline:ReactNode}
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v))
const saved=(key:string,def:number)=>{try{const v=Number(localStorage.getItem(key));return v>0?v:def}catch{return def}}
export function ResizableEditor({left,center,right,timeline}:Props){
 const root=useRef<HTMLElement>(null)
 const [l,setL]=useState(()=>saved('cliptora.left',27)),[r,setR]=useState(()=>saved('cliptora.right',22)),[t,setT]=useState(()=>saved('cliptora.top',49))
 const drag=useRef<{axis:Axis;x:number;y:number;initial:number}|null>(null)
 const update=(axis:Axis,value:number)=>{if(axis==='left')setL(value);else if(axis==='right')setR(value);else setT(value)}
 const value=(axis:Axis)=>axis==='left'?l:axis==='right'?r:t
 function down(axis:Axis,e:PointerEvent<HTMLDivElement>){if(e.button!==0)return;e.preventDefault();drag.current={axis,x:e.clientX,y:e.clientY,initial:value(axis)};e.currentTarget.setPointerCapture(e.pointerId)}
 function move(e:PointerEvent<HTMLDivElement>){const d=drag.current,rect=root.current?.getBoundingClientRect();if(!d||!rect)return
  if(d.axis==='left')update(d.axis,clamp(d.initial+(e.clientX-d.x)/rect.width*100,15,100-r-25))
  else if(d.axis==='right')update(d.axis,clamp(d.initial-(e.clientX-d.x)/rect.width*100,15,100-l-25))
  else update(d.axis,clamp(d.initial+(e.clientY-d.y)/rect.height*100,25,75))
 }
 function up(e:PointerEvent<HTMLDivElement>){const d=drag.current;if(!d)return;drag.current=null;localStorage.setItem('cliptora.'+(d.axis==='horizontal'?'top':d.axis),String(value(d.axis)));if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}
 function separator(axis:Axis){return {role:'separator' as const,tabIndex:0,'aria-label':axis==='horizontal'?'Resize timeline height':'Resize '+axis+' panel','aria-orientation':axis==='horizontal'?'horizontal' as const:'vertical' as const,onPointerDown:(e:PointerEvent<HTMLDivElement>)=>down(axis,e),onPointerMove:move,onPointerUp:up,onPointerCancel:up,onDoubleClick:()=>{const v=axis==='left'?27:axis==='right'?22:49;update(axis,v);localStorage.setItem('cliptora.'+(axis==='horizontal'?'top':axis),String(v))},onKeyDown:(e:KeyboardEvent<HTMLDivElement>)=>{const s=e.key==='ArrowRight'||e.key==='ArrowDown'?2:e.key==='ArrowLeft'||e.key==='ArrowUp'?-2:0;if(!s)return;e.preventDefault();update(axis,clamp(value(axis)+(axis==='right'?-s:s),axis==='horizontal'?25:15,axis==='horizontal'?75:45))}}}
 return <main ref={root} className="grid min-h-0 min-w-0 w-full flex-1 overflow-hidden px-1.5 pb-1.5" style={{gridTemplateRows:`minmax(0,${t}fr) 7px minmax(0,${100-t}fr)`}}>
  <div className="grid min-h-0 min-w-0 overflow-hidden" style={{gridTemplateColumns:`minmax(0,${l}fr) 7px minmax(0,${100-l-r}fr) 7px minmax(0,${r}fr)`}}>
   <div className="flex min-h-0 min-w-0 overflow-hidden rounded-md bg-cl-panel">{left}</div>
   <div {...separator('left')} className="group relative z-40 cursor-col-resize touch-none"><div className="absolute inset-y-3 left-[2px] w-[3px] rounded-full group-hover:bg-cl-purple group-active:bg-cl-cyan"/></div>
   <div className="min-h-0 min-w-0 overflow-hidden rounded-md bg-cl-panel">{center}</div>
   <div {...separator('right')} className="group relative z-40 cursor-col-resize touch-none"><div className="absolute inset-y-3 left-[2px] w-[3px] rounded-full group-hover:bg-cl-purple group-active:bg-cl-cyan"/></div>
   <div className="min-h-0 min-w-0 overflow-hidden rounded-md bg-cl-panel">{right}</div>
  </div>
  <div {...separator('horizontal')} className="group relative z-40 cursor-row-resize touch-none"><div className="absolute inset-x-3 top-[2px] h-[3px] rounded-full group-hover:bg-cl-purple group-active:bg-cl-cyan"/></div>
  <div className="flex min-h-0 min-w-0 flex-col overflow-hidden"><div className="min-h-0 flex-1">{timeline}</div></div>
 </main>
}
