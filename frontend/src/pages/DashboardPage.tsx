import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, MoreHorizontal, Play, Plus, Search, TextCursorInput, Trash2, Video } from 'lucide-react'
import { api } from '../api'
import { useMutation, useQuery, useQueryClient } from '../query'
import type { Project } from '../types'
import { Button } from '../components/ui/Controls'
import { AppHeader } from '../components/AppHeader'
import { ProjectModal } from '../features/projects/ProjectModal'

export function DashboardPage() {
  const client=useQueryClient(); const navigate=useNavigate(); const [search,setSearch]=useState(''); const [modal,setModal]=useState<Project|true|null>(null); const [menu,setMenu]=useState<number|null>(null)
  const projects=useQuery({queryKey:['projects'],queryFn:()=>api<Project[]>('/projects')})
  const mutate=useMutation({mutationFn:({id,action}:{id:number;action:'duplicate'|'delete'})=>api(action==='duplicate'?`/projects/${id}/duplicate`:`/projects/${id}`,{method:action==='duplicate'?'POST':'DELETE'}),onSuccess:()=>client.invalidateQueries({queryKey:['projects']})})
  const filtered=(projects.data??[]).filter(p=>p.name.toLowerCase().includes(search.toLowerCase()))
  return <div className="app-shell"><AppHeader/><main className="dashboard"><section className="dashboard-heading"><div><p className="eyebrow">YOUR WORKSPACE</p><h1>Projects</h1><span>Pick up a cut or start something new.</span></div><Button icon={<Plus/>} onClick={()=>setModal(true)}>New project</Button></section><div className="project-toolbar"><div className="searchbox"><Search/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search projects"/></div><span>{filtered.length} project{filtered.length!==1?'s':''}</span></div>{projects.isLoading?<div className="project-grid">{[1,2,3].map(i=><div className="project-card skeleton" key={i}/>)}</div>:filtered.length?<div className="project-grid">{filtered.map((project,index)=><article className="project-card" key={project.id}><button className="project-preview" onClick={()=>navigate(`/projects/${project.id}/editor`)}><img src="/assets/planet-demo.png" alt=""/><span>{project.aspect_ratio}</span><div className="project-play"><Play fill="currentColor"/></div></button><div className="project-meta"><div><h3>{project.name}</h3><p>{project.width}×{project.height} · {project.fps} FPS</p></div><button onClick={()=>setMenu(menu===project.id?null:project.id)}><MoreHorizontal/></button>{menu===project.id&&<div className="card-menu"><button onClick={()=>setModal(project)}><TextCursorInput/>Rename</button><button onClick={()=>mutate.mutate({id:project.id,action:'duplicate'})}><Copy/>Duplicate</button><button className="danger" onClick={()=>confirm(`Delete “${project.name}”?`)&&mutate.mutate({id:project.id,action:'delete'})}><Trash2/>Delete</button></div>}</div><footer><span>Updated {new Date(project.updated_at).toLocaleDateString()}</span><b>0:00</b></footer></article>)}</div>:<div className="empty-projects"><div><Video/></div><h2>Your studio is ready</h2><p>Create your first project. Your media and edits stay private to your account.</p><Button icon={<Plus/>} onClick={()=>setModal(true)}>Create project</Button></div>}</main>{modal&&<ProjectModal project={modal===true?undefined:modal} onClose={()=>setModal(null)}/>}</div>
}
