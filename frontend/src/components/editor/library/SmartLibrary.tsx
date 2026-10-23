import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Boxes, Folder, Grid2X2, List, Plus, Search, Shapes, Type, WandSparkles } from 'lucide-react'
import { ComponentThumbnail, SavedComponentThumbnail, shapeCategory } from './ComponentThumbnail'
import { api } from '../../../lib/api'
import { animations, effects, shapes } from '../../../lib/catalog'
import { evaluateExpression, interpolateVariables, type VariableType } from '../../../lib/variables'
import { useEditor } from '../../../stores/editorStore'
import type { Tab } from '../sidebar/ToolRail'

type Kind = 'component'|'group'|'folder'|'effect'|'animation'|'variable'
type LibraryItem = { id:number;kind:Kind;name:string;parent_id:number|null;payload:Record<string,unknown> }
const fields = 'rounded-md border border-[#333940] bg-[#171a1e] px-2 py-1.5 text-xs text-white outline-none focus:border-[#9060d9]'
const button = 'rounded-md border border-[#41464e] px-2 py-1.5 text-xs text-[#d2d4da] hover:bg-[#30343b]'
const types:VariableType[] = ['string','number','boolean','color','date','datetime','duration','percentage','url','media','select','json']

export function SmartLibrary({active}:{active:Tab}) {
 const tracks=useEditor(s=>s.tracks),selectedClipId=useEditor(s=>s.selectedClipId),patchProps=useEditor(s=>s.patchProps),patchClip=useEditor(s=>s.patchClip)
 const [all,setAll]=useState<LibraryItem[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[search,setSearch]=useState('')
 const [name,setName]=useState(''),[varType,setVarType]=useState<VariableType>('string'),[value,setValue]=useState('')
 const [folder,setFolder]=useState<number|null>(null),[expression,setExpression]=useState('{{project.title}} — {{now() + 1h}}')
 const [componentCategory,setComponentCategory]=useState<'All'|'Text'|'Shapes'|'Blur'|'Saved'>('All')
 const [componentView,setComponentView]=useState<'grid'|'list'>('grid')
 const [cardSize,setCardSize]=useState<'compact'|'comfortable'>('comfortable')
 const selected=tracks.flatMap(track=>track.clips).find(clip=>clip.client_id===selectedClipId)
 const clips=tracks.flatMap(track=>track.clips)
 const refresh=useCallback(async()=>{try{setAll(await api<LibraryItem[]>('/library'));setError('')}catch(e){setError(e instanceof Error ? e.message : 'Cannot load library')}},[])
 useEffect(()=>{void refresh()},[refresh])
 async function save(kind:Kind,label:string,payload:Record<string,unknown>,parentId:number|null=folder){
   if(!label.trim())return
   setBusy(true);try{await api('/library',{method:'POST',body:JSON.stringify({kind,name:label.trim(),payload,parent_id:parentId})});await refresh();setName('')}catch(e){setError(e instanceof Error?e.message:'Save failed')}finally{setBusy(false)}
 }
 async function remove(item:LibraryItem){if(!window.confirm(`Delete ${item.name}?`))return;try{await api(`/library/${item.id}`,{method:'DELETE'});await refresh()}catch(e){setError(e instanceof Error?e.message:'Delete failed')}}
 function apply(item:LibraryItem){if(!selected){setError('Select a clip in Timeline first.');return}
   if(item.kind==='effect') patchProps(selected.client_id,{effect_stack:[...(selected.props?.effect_stack??[]),{...item.payload,name:item.name}]})
   if(item.kind==='animation') patchProps(selected.client_id,{animation_stack:[...(selected.props?.animation_stack??[]),{...item.payload,name:item.name}]})
   if(item.kind==='component'||item.kind==='group'){
     const snapshot=item.payload.snapshot as Record<string,unknown> | undefined
     if(snapshot){patchClip(selected.client_id,{name:item.name,text:typeof snapshot.text==='string'?snapshot.text:selected.text,color:typeof snapshot.color==='string'?snapshot.color:selected.color});patchProps(selected.client_id,(snapshot.props??{}) as import('../../../types').ClipProperties)}
   }
 }
 function addShape(shape: typeof shapes[number]) {
   if (!useEditor.getState().addShapeClip(shape)) setError('No free space at playhead. Unlock a layer or create a new layer.')
 }
 function dragShape(event: import('react').DragEvent<HTMLButtonElement>, shape: typeof shapes[number]) {
   useEditor.getState().startDrag({kind:'shape',shape,duration:5})
   event.dataTransfer.setData('application/x-cliptora',`shape:${shape}`)
   event.dataTransfer.setData('text/plain',`cliptora:shape:${shape}`)
   event.dataTransfer.effectAllowed='copy'
 }
 const vars=Object.fromEntries(all.filter(item=>item.kind==='variable').map(item=>[item.name,{type:(item.payload.type??'string') as VariableType,value:item.payload.value}]))
 const context={'project.title':'Current project','project.description':'','project.created_at':'','project.updated_at':'','project.width':1920,'project.height':1080,'project.resolution':'1920×1080','project.fps':30,'project.duration':Math.max(0,...clips.map(c=>c.start+c.duration)),'project.clips_count':clips.length,'project.layers_count':tracks.length,'media.file_name':'','media.extension':'','system.now':new Date().toISOString()}
 const folders=all.filter(item=>item.kind==='folder')
 const visible=useMemo(()=>all.filter(item=>item.parent_id===folder && item.kind!=='folder' && item.name.toLowerCase().includes(search.toLowerCase())),[all,folder,search])
 const current=all.find(item=>item.id===folder)
 const visibleShapes=shapes.filter(shape => (componentCategory==='All' || componentCategory===shapeCategory(shape)) && shape.toLowerCase().includes(search.toLowerCase()))
 const visibleSaved=visible.filter(item=>['component','group'].includes(item.kind))
 const showBuiltin=componentCategory!=='Saved'
 const showSaved=componentCategory==='All'||componentCategory==='Saved'
 return <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain p-3 text-xs text-white">
  <header className="mb-3 flex shrink-0 items-center justify-between gap-2"><strong className="text-sm">{active==='components'?'Components':active==='variables'?'Variables':active==='animations'?'Animations':'Effects'}</strong><button className={button} onClick={()=>void refresh()}>Refresh</button></header>
  {error&&<p role="alert" className="mb-3 rounded bg-red-900/30 p-2 text-red-300">{error}</p>}
  {active==='components'&&<>
   
   <div className="mb-2 flex min-w-0 shrink-0 items-center gap-2 rounded-lg border border-[#343944] bg-[#121519] px-2.5 py-2">
     <Search size={15} className="shrink-0 text-[#8d94a1]"/>
     <input value={search} onChange={event=>setSearch(event.target.value)} aria-label="Search components" placeholder="Search components..." className="w-full min-w-0 bg-transparent text-xs text-white outline-none placeholder:text-[#777f8e]"/>
     {search&&<button type="button" onClick={()=>setSearch('')} className="text-[#8e97a3] hover:text-white" aria-label="Clear search">×</button>}
   </div>
   {/* Avoid flex shrink collapsing category tabs when the sidebar contains many cards. */}
   <nav className="mb-3 flex min-h-[36px] w-full shrink-0 flex-wrap items-center gap-1.5" aria-label="Component categories">
     {(['All','Text','Shapes','Blur','Saved'] as const).map(category=><button key={category} type="button" aria-pressed={componentCategory===category} onClick={()=>setComponentCategory(category)} className={`inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 text-[11px] font-semibold leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ae83ff] ${componentCategory===category?'bg-[#7847d5] text-white':'bg-[#252830] text-[#c4c8d1] hover:bg-[#343442] hover:text-white'}`}>{category==='Saved'?'My Components':category}</button>)}
   </nav>
   <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
     <span className="truncate text-[11px] text-[#8e98a4]">{componentCategory==='Saved'?'Your reusable library':`${visibleShapes.length} elements available`}</span>
     <div className="flex shrink-0 items-center gap-1" aria-label="Component display options">
       <button type="button" aria-pressed={cardSize==='compact'} onClick={()=>setCardSize(s=>s==='compact'?'comfortable':'compact')} title="Toggle card size" className="rounded p-1.5 text-[#a0a6b0] hover:bg-[#30343d] hover:text-white"><Shapes size={14}/></button>
       <button type="button" aria-pressed={componentView==='grid'} onClick={()=>setComponentView('grid')} title="Grid view" className={`rounded p-1.5 ${componentView==='grid'?'bg-[#3a2a56] text-[#d3b3ff]':'text-[#8b929e]'}`}><Grid2X2 size={14}/></button>
       <button type="button" aria-pressed={componentView==='list'} onClick={()=>setComponentView('list')} title="List view" className={`rounded p-1.5 ${componentView==='list'?'bg-[#3a2a56] text-[#d3b3ff]':'text-[#8b929e]'}`}><List size={14}/></button>
     </div>
   </div>
   {showBuiltin&&<>
     {(['Text','Shapes','Blur'] as const).map(category=>{
       const entries=visibleShapes.filter(shape=>shapeCategory(shape)===category)
       if(!entries.length) return null
       const CategoryIcon=category==='Text'?Type:category==='Blur'?WandSparkles:Shapes
       return <div key={category} className="mb-3">
         <div className="mb-2 flex items-center gap-2"><CategoryIcon size={15} className={category==='Blur'?'text-[#63dce5]':'text-[#ae86f1]'}/><h3 className="text-xs font-semibold text-[#e6e6eb]">{category}</h3><span className="rounded bg-[#252830] px-1.5 text-[10px] text-[#a1a5ae]">{entries.length}</span></div>
         <div className={componentView==='grid'?'grid gap-2':'flex flex-col gap-1.5'} style={componentView==='grid'?{gridTemplateColumns:`repeat(auto-fill,minmax(${cardSize==='compact'?100:142}px,1fr))`}:undefined}>
           {entries.map(shape=><button key={shape} type="button" draggable onDragStart={event=>dragShape(event,shape)} onDragEnd={()=>useEditor.getState().startDrag(null)} title={`Add ${shape} to Timeline`} aria-label={`Add ${shape} to Timeline`} className={`group min-w-0 overflow-hidden rounded-lg border border-[#343c47] bg-[#1b1f26] text-left transition-all hover:border-[#9868f0] hover:bg-[#242430] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ae83ff] ${componentView==='list'?'flex items-center gap-2 p-1.5':'flex flex-col'}`} onClick={()=>addShape(shape)}>
             <div className={`relative shrink-0 overflow-hidden rounded-t-md ${componentView==='list'?'h-11 w-16 rounded-md':cardSize==='compact'?'h-[70px] w-full':'h-[96px] w-full'}`}><ComponentThumbnail name={shape} compact={cardSize==='compact'}/></div>
             <div className={`flex min-w-0 flex-1 items-center justify-between gap-1 ${componentView==='list'?'pr-1':'px-2 py-2'}`}>
               <span className="min-w-0 text-[11px] font-medium leading-4 text-[#e0e1e8]" title={shape}>{shape}</span>
               <span className="shrink-0 rounded-md bg-[#333744] p-1 text-[#b5a0d9] group-hover:bg-[#7544cc] group-hover:text-white"><Plus size={11}/></span>
             </div>
           </button>)}
         </div>
       </div>
     })}
     {!visibleShapes.length&&<p className="rounded-lg border border-dashed border-[#363c46] p-4 text-center text-[11px] text-[#a5abb5]">No matching elements.</p>}
   </>}
   {showSaved&&<>
   <div className="mt-1 mb-2 flex items-center gap-2"><Boxes size={15} className="text-[#b78afc]"/><h3 className="text-xs font-semibold">My Components</h3><span className="rounded bg-[#252830] px-1.5 text-[10px] text-[#a1a5ae]">{visibleSaved.length}</span></div>
   <div className="mb-2 flex items-center gap-2">
     {folder!==null?<button className={button} onClick={()=>setFolder(current?.parent_id??null)} title="Back to parent folder"><ArrowLeft size={13}/></button>:null}
     <span className="min-w-0 flex-1 truncate text-[11px] text-[#a8adba]">{current?.name??'My Components /'}</span>
   </div>
     <div className="mb-2 grid grid-cols-2 gap-1.5">{folders.filter(f=>f.parent_id===folder&&f.name.toLowerCase().includes(search.toLowerCase())).map(f=><button key={f.id} className="flex items-center gap-1.5 rounded-lg border border-[#353a45] bg-[#21242b] px-2 py-2 text-left text-[11px] hover:border-[#9360d8]" onClick={()=>setFolder(f.id)}><Folder size={14} className="shrink-0 text-[#b998fa]"/><span className="min-w-0 truncate">{f.name}</span></button>)}</div>
     {visibleSaved.length>0?<div className={componentView==='grid'?'grid gap-2':'flex flex-col gap-1.5'} style={componentView==='grid'?{gridTemplateColumns:`repeat(auto-fill,minmax(${cardSize==='compact'?100:142}px,1fr))`}:undefined}>
       {visibleSaved.map(item=>{
         const snapshot = item.payload.snapshot as Record<string,unknown>|undefined
         return <div key={item.id} className={`group min-w-0 overflow-hidden rounded-lg border border-[#363945] bg-[#21242b] ${componentView==='list'?'flex items-center gap-1.5 p-1.5':'flex flex-col'}`}>
           <div className={`shrink-0 overflow-hidden rounded-md ${componentView==='list'?'h-11 w-16':cardSize==='compact'?'h-[70px] w-full':'h-[96px] w-full'}`}><SavedComponentThumbnail snapshot={snapshot} kind={item.kind as 'component'|'group'}/></div>
           <div className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-2"><span className="min-w-0 flex-1 truncate text-[11px] text-[#e0e1e8]" title={item.name}>{item.name}</span><button onClick={()=>apply(item)} disabled={!selected} title="Apply to selected clip" aria-label={`Apply ${item.name}`} className="rounded bg-[#6941b6] p-1 text-white hover:bg-[#8859ed] disabled:cursor-not-allowed disabled:opacity-40"><Plus size={12}/></button><button onClick={()=>void remove(item)} aria-label={`Delete ${item.name}`} title="Delete saved component" className="rounded px-1 text-[#9299a5] hover:text-red-400">×</button></div>
         </div>
       })}
     </div>:<p className="rounded-lg border border-dashed border-[#343946] px-3 py-4 text-center text-[11px] leading-5 text-[#9299a5]">No saved components here. Select an object in Timeline and save it below.</p>}
     <div className="mt-3 flex gap-1.5"><input className={`${fields} min-w-0 flex-1`} placeholder="Folder / component name" value={name} onChange={e=>setName(e.target.value)}/><button type="button" title="Create folder" className={button} disabled={busy||!name.trim()} onClick={()=>void save('folder',name,{})}><Folder size={13}/> +</button></div>
     <div className="mt-2 grid grid-cols-2 gap-1.5"><button className={button} disabled={!selected||busy} onClick={()=>selected&&void save('component',name||selected.name,{snapshot:selected})}>Save selected clip</button><button className={button} disabled={busy||!name.trim()} onClick={()=>void save('group',name,{children:[]})}>Create group</button></div>
   </>}
  </>}
  {active==='variables'&&<>
   <p className="mb-2 text-[#9ea5ae]">Typed global values, stored in MySQL. Expressions accept now(), today(), durations and references.</p>
   <input className={`${fields} mb-2`} value={name} placeholder="variable name e.g. brand_color" onChange={e=>setName(e.target.value)}/>
   <select className={`${fields} mb-2`} value={varType} onChange={e=>setVarType(e.target.value as VariableType)}>{types.map(t=><option key={t}>{t}</option>)}</select>
   <input className={`${fields} mb-2`} value={value} placeholder="Value" onChange={e=>setValue(e.target.value)}/>
   <button className={button} disabled={busy||!/^[_a-zA-Z][\w.]*$/.test(name)} onClick={()=>void save('variable',name,{type:varType,value:varType==='number'?Number(value):varType==='boolean'?value==='true':value})}>Save global variable</button>
   <label className="mt-4 mb-1 text-[#9ea5ae]">Expression preview</label><input className={fields} value={expression} onChange={e=>setExpression(e.target.value)}/>
   <p className="mt-2 break-all rounded bg-[#20242b] p-2">{interpolateVariables(expression,vars,context)}</p>
   <p className="mt-2 text-[#8f98a6]">Example: {'{{now() + 1h}}'} → {String(evaluateExpression('now() + 1h',vars,context))}</p>
  </>}
  {(active==='effects'||active==='animations')&&<>
   <p className="mb-2 text-[#9ea5ae]">{active==='effects'?'50 effect definitions':'30 animation definitions'} · Save your presets globally. Advanced rendering depends on the export engine.</p>
   <input className={fields} placeholder="Search library" value={search} onChange={e=>setSearch(e.target.value)}/>
   <div className="mt-2 max-h-56 overflow-y-auto rounded border border-[#31363c]">{(active==='effects'?effects:animations).filter(entry=>entry.name.toLowerCase().includes(search.toLowerCase())).map(entry=><div key={`${entry.group}/${entry.name}`} className="flex items-center justify-between gap-1 border-b border-[#31363c] p-2"><div><strong>{entry.name}</strong><div className="text-[10px] text-[#9ea5ae]">{entry.group} · {entry.engine}</div></div><button className={button} disabled={busy} onClick={()=>void save(entry.kind,entry.name,{...entry,parameters:Object.fromEntries(entry.parameters.map(p=>[p, p==='duration'?1:p==='enabled'?true:0.5]))},null)}>Save preset</button></div>)}</div>
   <p className="my-2 text-[#a0a6b0]">Create compound custom preset: save selected clip's configured stack.</p>
   <div className="flex gap-1"><input className={`${fields} min-w-0 flex-1`} placeholder="My custom preset" value={name} onChange={e=>setName(e.target.value)}/><button className={button} disabled={!selected||!name.trim()} onClick={()=>void save(active==='effects'?'effect':'animation',name,{name,stack:active==='effects'?selected?.props?.effect_stack??[]:selected?.props?.animation_stack??[]},null)}>Save</button></div>
  </>}
  {active!=='components'&&<div className="mt-3 border-t border-[#30343b] pt-2"><strong>Saved library</strong>{visible.filter(item=>active==='variables'?item.kind==='variable':item.kind===active.slice(0,-1)).map(item=><div className="mt-2 flex items-center gap-2 rounded bg-[#24272e] p-2" key={item.id}><span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>{active!=='variables'&&<button className={button} onClick={()=>apply(item)}>Apply</button>}<button className={button} onClick={()=>void remove(item)}>×</button></div>)}</div>}

 </section>
}
