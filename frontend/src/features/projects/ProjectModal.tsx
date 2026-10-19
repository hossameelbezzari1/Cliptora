import { useState } from 'react'
import { X } from 'lucide-react'
import { useMutation, useQueryClient } from '../../query'
import { api } from '../../api'
import type { Project } from '../../types'
import { Button, Field, ErrorMessage } from '../../components/ui/Controls'

export function ProjectModal({ project, onClose }: { project?: Project; onClose:()=>void }) {
  const client = useQueryClient(); const [name,setName]=useState(project?.name ?? 'Untitled project'); const [ratio,setRatio]=useState(project?.aspect_ratio ?? '16:9'); const [fps,setFps]=useState(project?.fps ?? 30)
  const mutation=useMutation({mutationFn:()=>api<Project>(project?`/projects/${project.id}`:'/projects',{method:project?'PATCH':'POST',body:JSON.stringify({name,aspect_ratio:ratio,fps,width:ratio==='9:16'?1080:ratio==='1:1'?1080:ratio==='4:5'?1080:1920,height:ratio==='9:16'?1920:ratio==='1:1'?1080:ratio==='4:5'?1350:1080})}),onSuccess:()=>{client.invalidateQueries({queryKey:['projects']});onClose()}})
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><form className="modal" onSubmit={e=>{e.preventDefault();mutation.mutate()}}><button type="button" className="modal-close" onClick={onClose}><X/></button><p className="eyebrow">PROJECT SETUP</p><h2>{project?'Rename project':'Create a new project'}</h2><Field label="Project name" value={name} onChange={e=>setName(e.target.value)} required/><div className="field-grid"><label className="field"><span>Aspect ratio</span><select value={ratio} onChange={e=>setRatio(e.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option><option>4:5</option></select></label><label className="field"><span>Frame rate</span><select value={fps} onChange={e=>setFps(+e.target.value)}><option>24</option><option>25</option><option>30</option><option>60</option></select></label></div><ErrorMessage error={mutation.error}/><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={mutation.isPending}>{project?'Save changes':'Create project'}</Button></div></form></div>
}
