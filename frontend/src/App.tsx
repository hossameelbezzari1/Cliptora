import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Routes, Route, Link, NavLink, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from './query'
import { create } from 'zustand'
import {
  Aperture, ArrowLeft, AudioLines, Bot, Check, ChevronDown, CircleUserRound, Copy, Crop,
  Download, Eye, EyeOff, FolderOpen, Gauge, Grid2X2, Image, LayoutDashboard, Lock, LogOut,
  Menu, Mic2, MoreHorizontal, MousePointer2, Move, Music2, PanelLeft, Pause, Play, Plus,
  Redo2, Save, Scissors, Search, Settings, Shapes, SlidersHorizontal, Sparkles, Square,
  TextCursorInput, Trash2, Undo2, Unlock, Upload, UserRound, Video, Volume2, WandSparkles,
  X, Zap,
} from 'lucide-react'
import { api, ApiError, clearCsrf } from './api'
import { AuthProvider, ProtectedRoute, useAuth } from './auth'
import type { Project, Timeline, Track, User } from './types'

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; icon?: ReactNode }
function Button({ variant = 'primary', icon, className = '', children, ...props }: ButtonProps) {
  return <button className={`btn btn-${variant} ${className}`} {...props}>{icon}{children}</button>
}
function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="field"><span>{label}</span><input {...props} /></label>
}
function Logo({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}><img src="/assets/cliptora-logo.png" alt="Cliptora" /><div><b>Cliptora</b>{!compact && <span>AI Video Editor</span>}</div></div>
}
function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null
  return <div role="alert" className="form-error">{error instanceof Error ? error.message : 'Something went wrong.'}</div>
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <main className="auth-page">
    <Link to="/" className="auth-brand"><Logo /></Link>
    <section className="auth-card">
      <div className="auth-accent"><Aperture size={20} /></div>
      <header><p>CLIPTORA WORKSPACE</p><h1>{title}</h1><span>{subtitle}</span></header>
      {children}
    </section>
    <p className="auth-footnote">Private projects · Secure sessions · Non-destructive editing</p>
  </main>
}

function LoginPage() {
  const navigate = useNavigate(); const location = useLocation(); const { refresh } = useAuth()
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const mutation = useMutation({ mutationFn: () => api<User>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }), onSuccess: async () => { clearCsrf(); await refresh(); navigate((location.state as {from?: string})?.from ?? '/dashboard', { replace: true }) } })
  return <AuthShell title="Welcome back" subtitle="Continue shaping your next story.">
    <form onSubmit={(e) => { e.preventDefault(); mutation.mutate() }} className="auth-form">
      <Field label="Email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
      <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
      <div className="form-row"><label className="check"><input type="checkbox" /> Keep me signed in</label><Link to="/forgot-password">Forgot password?</Link></div>
      <ErrorMessage error={mutation.error} />
      <Button disabled={mutation.isPending}>{mutation.isPending ? 'Signing in…' : 'Sign in'} <ArrowLeft className="button-arrow" size={18} /></Button>
    </form>
    <p className="auth-switch">New to Cliptora? <Link to="/register">Create an account</Link></p>
  </AuthShell>
}

function RegisterPage() {
  const navigate = useNavigate(); const { refresh } = useAuth()
  const [form, setForm] = useState({ display_name: '', email: '', password: '', password_confirmation: '' })
  const mutation = useMutation({ mutationFn: () => api<User>('/auth/register', { method: 'POST', body: JSON.stringify(form) }), onSuccess: async () => { clearCsrf(); await refresh(); navigate('/dashboard') } })
  return <AuthShell title="Create your studio" subtitle="One secure place for every cut and idea.">
    <form onSubmit={(e) => { e.preventDefault(); mutation.mutate() }} className="auth-form">
      <Field label="Display name" value={form.display_name} onChange={e => setForm({...form, display_name: e.target.value})} minLength={2} required />
      <Field label="Email" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required />
      <div className="field-grid"><Field label="Password" type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} minLength={10} required /><Field label="Confirm password" type="password" value={form.password_confirmation} onChange={e => setForm({...form, password_confirmation: e.target.value})} required /></div>
      <ErrorMessage error={mutation.error} /><Button disabled={mutation.isPending}>{mutation.isPending ? 'Creating…' : 'Create account'}</Button>
    </form>
    <p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>
  </AuthShell>
}

function ForgotPasswordPage() {
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false); const [devLink, setDevLink] = useState('')
  const mutation = useMutation({ mutationFn: () => api<{message:string; dev_reset_url?:string}>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }), onSuccess: data => { setSent(true); setDevLink(data.dev_reset_url ?? '') } })
  return <AuthShell title="Reset access" subtitle="We’ll send a short-lived recovery link.">
    {sent ? <div className="success-state"><div><Check /></div><h2>Check your inbox</h2><p>If that address exists, a reset link is on its way.</p>{devLink && <a href={devLink}>Open local development reset link</a>}<Link to="/login">Back to sign in</Link></div> : <form onSubmit={e => {e.preventDefault(); mutation.mutate()}} className="auth-form"><Field label="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required /><ErrorMessage error={mutation.error}/><Button disabled={mutation.isPending}>Send recovery link</Button></form>}
  </AuthShell>
}

function ResetPasswordPage() {
  const token = new URLSearchParams(useLocation().search).get('token') ?? ''; const navigate = useNavigate()
  const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState('')
  const mutation = useMutation({ mutationFn: () => api('/auth/reset-password', { method:'POST', body:JSON.stringify({token, password, password_confirmation:confirmation}) }), onSuccess:()=>navigate('/login') })
  return <AuthShell title="Choose a new password" subtitle="This will sign out all other sessions."><form className="auth-form" onSubmit={e=>{e.preventDefault();mutation.mutate()}}><Field label="New password" type="password" minLength={10} value={password} onChange={e=>setPassword(e.target.value)} required/><Field label="Confirm password" type="password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} required/><ErrorMessage error={mutation.error}/><Button disabled={!token || mutation.isPending}>Reset password</Button></form></AuthShell>
}

function AccountMenu() {
  const [open, setOpen] = useState(false); const { user, logout } = useAuth(); const navigate = useNavigate()
  return <div className="account-wrap"><button className="avatar" onClick={()=>setOpen(!open)} aria-expanded={open}>{user?.display_name.slice(0,2).toUpperCase()}</button>{open && <div className="account-menu"><div><strong>{user?.display_name}</strong><span>{user?.email}</span></div><Link to="/profile"><UserRound/>Profile</Link><button onClick={async()=>{await logout();navigate('/login')}}><LogOut/>Logout</button></div>}</div>
}

function AppHeader({ project, saving, onSave }: { project?: Project; saving?: string; onSave?:()=>void }) {
  return <header className="app-header"><Link to="/dashboard"><Logo /></Link><nav className="top-tools"><NavLink to="/dashboard" title="Projects"><Grid2X2/></NavLink><button title="Workspace"><Aperture/></button><button title="Files"><FolderOpen/></button><button title="Undo"><Undo2/></button><button title="Redo"><Redo2/></button></nav><div className="breadcrumbs"><span>Projects</span><b>/</b><strong>{project?.name ?? 'Your studio'}</strong>{project && <ChevronDown size={16}/>}</div><div className="header-actions">{saving && <span className={`save-state ${saving}`}><span/>{saving === 'saving' ? 'Saving…' : saving === 'error' ? 'Save failed' : 'Saved'}</span>}{onSave && <button className="round-tool" onClick={onSave} title="Save now"><Save/></button>}<AccountMenu />{project && <button className="export-btn" disabled title="Export arrives in Phase 6"><Download/> Export <small>Phase 6</small></button>}</div></header>
}

function ProjectModal({ project, onClose }: { project?: Project; onClose:()=>void }) {
  const client = useQueryClient(); const [name,setName]=useState(project?.name ?? 'Untitled project'); const [ratio,setRatio]=useState(project?.aspect_ratio ?? '16:9'); const [fps,setFps]=useState(project?.fps ?? 30)
  const mutation=useMutation({mutationFn:()=>api<Project>(project?`/projects/${project.id}`:'/projects',{method:project?'PATCH':'POST',body:JSON.stringify({name,aspect_ratio:ratio,fps,width:ratio==='9:16'?1080:1920,height:ratio==='9:16'?1920:1080})}),onSuccess:()=>{client.invalidateQueries({queryKey:['projects']});onClose()}})
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><form className="modal" onSubmit={e=>{e.preventDefault();mutation.mutate()}}><button type="button" className="modal-close" onClick={onClose}><X/></button><p className="eyebrow">PROJECT SETUP</p><h2>{project?'Rename project':'Create a new project'}</h2><Field label="Project name" value={name} onChange={e=>setName(e.target.value)} required/><div className="field-grid"><label className="field"><span>Aspect ratio</span><select value={ratio} onChange={e=>setRatio(e.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option><option>4:5</option></select></label><label className="field"><span>Frame rate</span><select value={fps} onChange={e=>setFps(+e.target.value)}><option>24</option><option>25</option><option>30</option><option>60</option></select></label></div><ErrorMessage error={mutation.error}/><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={mutation.isPending}>{project?'Save changes':'Create project'}</Button></div></form></div>
}

function DashboardPage() {
  const client=useQueryClient(); const navigate=useNavigate(); const [search,setSearch]=useState(''); const [modal,setModal]=useState<Project|true|null>(null); const [menu,setMenu]=useState<number|null>(null)
  const projects=useQuery({queryKey:['projects'],queryFn:()=>api<Project[]>('/projects')})
  const mutate=useMutation({mutationFn:({id,action}:{id:number;action:'duplicate'|'delete'})=>api(action==='duplicate'?`/projects/${id}/duplicate`:`/projects/${id}`,{method:action==='duplicate'?'POST':'DELETE'}),onSuccess:()=>client.invalidateQueries({queryKey:['projects']})})
  const filtered=(projects.data??[]).filter(p=>p.name.toLowerCase().includes(search.toLowerCase()))
  return <div className="app-shell"><AppHeader/><main className="dashboard"><section className="dashboard-heading"><div><p className="eyebrow">YOUR WORKSPACE</p><h1>Projects</h1><span>Pick up a cut or start something new.</span></div><Button icon={<Plus/>} onClick={()=>setModal(true)}>New project</Button></section><div className="project-toolbar"><div className="searchbox"><Search/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search projects"/></div><span>{filtered.length} project{filtered.length!==1?'s':''}</span></div>{projects.isLoading?<div className="project-grid">{[1,2,3].map(i=><div className="project-card skeleton" key={i}/>)}</div>:filtered.length?<div className="project-grid">{filtered.map((project,index)=><article className="project-card" key={project.id}><button className="project-preview" onClick={()=>navigate(`/projects/${project.id}/editor`)}><img src="/assets/planet-demo.png" alt=""/><span>{project.aspect_ratio}</span><div className="project-play"><Play fill="currentColor"/></div></button><div className="project-meta"><div><h3>{project.name}</h3><p>{project.width}×{project.height} · {project.fps} FPS</p></div><button onClick={()=>setMenu(menu===project.id?null:project.id)}><MoreHorizontal/></button>{menu===project.id&&<div className="card-menu"><button onClick={()=>setModal(project)}><TextCursorInput/>Rename</button><button onClick={()=>mutate.mutate({id:project.id,action:'duplicate'})}><Copy/>Duplicate</button><button className="danger" onClick={()=>confirm(`Delete “${project.name}”?`)&&mutate.mutate({id:project.id,action:'delete'})}><Trash2/>Delete</button></div>}</div><footer><span>Updated {new Date(project.updated_at).toLocaleDateString()}</span><b>0:00</b></footer></article>)}</div>:<div className="empty-projects"><div><Video/></div><h2>Your studio is ready</h2><p>Create your first project. Your media and edits stay private to your account.</p><Button icon={<Plus/>} onClick={()=>setModal(true)}>Create project</Button></div>}</main>{modal&&<ProjectModal project={modal===true?undefined:modal} onClose={()=>setModal(null)}/>}</div>
}

type EditorStore={playhead:number;selectedTrack:string|null;demo:boolean;setPlayhead:(v:number)=>void;select:(id:string|null)=>void;toggleDemo:()=>void}
const useEditor=create<EditorStore>(set=>({playhead:44,selectedTrack:'text-1',demo:true,setPlayhead:playhead=>set({playhead}),select:selectedTrack=>set({selectedTrack}),toggleDemo:()=>set(s=>({demo:!s.demo}))}))
const libraryItems=[{id:'media',icon:FolderOpen,label:'Media'},{id:'components',icon:Shapes,label:'Components'},{id:'ai',icon:Bot,label:'AI Scripts'},{id:'effects',icon:WandSparkles,label:'Effects'},{id:'transitions',icon:Sparkles,label:'Transitions'},{id:'audio',icon:Mic2,label:'Audio'}]

function EditorPage(){
  const {id}=useParams(); const client=useQueryClient(); const [active,setActive]=useState('media'); const [saving,setSaving]=useState('saved'); const [localTracks,setLocalTracks]=useState<Track[]>([]); const [menuOpen,setMenuOpen]=useState(false)
  const project=useQuery({queryKey:['project',id],queryFn:()=>api<Project>(`/projects/${id}`)})
  const timeline=useQuery({queryKey:['timeline',id],queryFn:()=>api<Timeline>(`/projects/${id}/timeline`),enabled:!!project.data})
  useEffect(()=>{if(timeline.data)setLocalTracks(timeline.data.tracks)},[timeline.data])
  const save=useMutation({mutationFn:()=>{setSaving('saving');return api<Timeline>(`/projects/${id}/timeline`,{method:'PUT',body:JSON.stringify({revision:timeline.data?.revision??0,tracks:localTracks})})},onSuccess:data=>{client.setQueryData(['timeline',id],data);setSaving('saved')},onError:()=>setSaving('error')})
  const addTrack=(type:Track['type'])=>{setLocalTracks(v=>[...v,{client_id:crypto.randomUUID(),name:`${type[0].toUpperCase()}${v.filter(t=>t.type===type).length+1}`,type,position:v.length,hidden:false,muted:false,locked:false}]);setMenuOpen(false);setSaving('saving')}
  useEffect(()=>{if(saving!=='saving'||!timeline.data)return;const timer=setTimeout(()=>save.mutate(),900);return()=>clearTimeout(timer)},[localTracks])
  if(project.error instanceof ApiError&&project.error.status===404)return <Navigate to="/dashboard" replace/>
  if(!project.data)return <div className="page-loader"><span/></div>
  return <div className="editor-shell"><AppHeader project={project.data} saving={saving} onSave={()=>save.mutate()}/><main className="editor-workspace"><section className="upper-workspace"><aside className="library-panel"><nav className="tool-rail">{libraryItems.map(item=><button key={item.id} className={active===item.id?'active':''} onClick={()=>setActive(item.id)} title={item.label}><item.icon/><span>{item.label}</span></button>)}</nav><Library active={active}/></aside><Preview/><Inspector/></section><Timeline tracks={localTracks} setTracks={setLocalTracks} onAdd={()=>setMenuOpen(!menuOpen)} menuOpen={menuOpen} addTrack={addTrack}/></main></div>
}

function Library({active}:{active:string}){
  const {demo,toggleDemo}=useEditor()
  if(active!=='media')return <div className="library-content future-library"><div className="library-title"><span><Sparkles/> {libraryItems.find(i=>i.id===active)?.label}</span></div><div className="coming"><Lock/><h3>Planned workspace</h3><p>This tool is intentionally unavailable until its implementation phase. Nothing here pretends to run.</p></div></div>
  return <div className="library-content"><div className="library-title"><span><Upload/> Import media</span><button title="Media options"><MoreHorizontal/></button></div><div className="media-tabs"><button className="active">All media</button><button>Video</button><button>Image</button><button>Sound</button></div><div className="demo-banner"><span>DEMO MEDIA</span><label><input type="checkbox" checked={demo} onChange={toggleDemo}/> Show reference content</label></div>{demo?<div className="media-grid"><button><img src="/assets/planet-demo.png" alt="Demo planet"/><span>Planet.png</span></button><button><img src="/assets/planet-demo.png" alt="Demo space clip"/><span>Origin.mp4</span></button><button className="audio-card"><AudioLines/><span>Intro-sound.mp3</span></button><button className="upload-card" disabled><Upload/><span>Upload in Phase 2</span></button></div>:<div className="empty-library"><Image/><p>No media in this project</p><span>Media import arrives in Phase 2.</span></div>}</div>
}

function Preview(){
  const {playhead,setPlayhead,demo}=useEditor(); const [playing,setPlaying]=useState(false); const timer=useRef<number|undefined>(undefined)
  useEffect(()=>{if(playing){timer.current=window.setInterval(()=>setPlayhead(Math.min(90,playhead+0.2)),200)}return()=>clearInterval(timer.current)},[playing,playhead])
  return <section className="preview-area"><div className="preview-frame">{demo?<img src="/assets/planet-demo.png" alt="Demo project preview"/>:<div className="blank-preview"><Aperture/><span>Preview canvas</span></div>}{demo&&<div className="selected-title"><i/><i/><i/><i/><strong>Law Of<br/>Conservation Of<br/>Energy</strong></div>}<span className="demo-chip">DEMO PREVIEW</span></div><div className="preview-controls"><button className="ratio">16 : 9 <ChevronDown/></button><div className="play-controls"><button><Volume2/></button><button onClick={()=>setPlaying(!playing)}>{playing?<Pause/>:<Play/>}</button><span>{formatTime(playhead)} / 01:30</span><input type="range" min="0" max="90" value={playhead} onChange={e=>setPlayhead(+e.target.value)}/></div><div className="preview-actions"><button><Crop/></button><button><SlidersHorizontal/></button><button><Square/></button></div></div></section>
}

function Inspector(){const [color,setColor]=useState('#5BFF93');const [size,setSize]=useState(29);const {demo}=useEditor();return <aside className="inspector"><div className="inspector-heading"><h2>Text Setting :</h2><MoreHorizontal/></div>{demo?<><section className="inspector-group"><div className="control-row"><select><option>Nunito Sans</option><option>Inter</option></select><label className="number-control"><input type="number" value={size} onChange={e=>setSize(+e.target.value)}/><span>px</span></label><select><option>Black</option><option>Bold</option></select></div><div className="control-row"><button className="wide">Auto</button><button>1.5%</button><button>0</button></div><div className="align-row"><button className="active"><PanelLeft/></button><button><Menu/></button><button><Move/></button><button><TextCursorInput/></button></div></section><section className="inspector-group"><label>Color</label><div className="color-control"><input type="color" value={color} onChange={e=>setColor(e.target.value)}/><span>{color.toUpperCase()}</span></div><button>100%</button></section><section className="inspector-group"><label>Border</label><div className="color-control"><i/><span>#000000</span></div><button>0%</button></section><section className="inspector-group transform"><label>Transform</label><div><span>X <input value="-320" readOnly/></span><span>Y <input value="-140" readOnly/></span></div></section></>:<div className="nothing-selected"><MousePointer2/><h3>Nothing selected</h3><p>Select a track or canvas object to edit its properties.</p></div>}</aside>}

function Timeline({tracks,setTracks,onAdd,menuOpen,addTrack}:{tracks:Track[];setTracks:(t:Track[])=>void;onAdd:()=>void;menuOpen:boolean;addTrack:(t:Track['type'])=>void}){
 const {playhead,setPlayhead,demo}=useEditor(); const ruler=useMemo(()=>Array.from({length:10},(_,i)=>i*10),[])
 const toggle=(id:string,key:'hidden'|'muted'|'locked')=>setTracks(tracks.map(t=>t.client_id===id?{...t,[key]:!t[key]}:t)); const remove=(id:string)=>setTracks(tracks.filter(t=>t.client_id!==id).map((t,i)=>({...t,position:i})))
 const shownTracks=tracks.length?tracks:demo?[{client_id:'media-demo',name:'MEDIA 1',type:'video',position:0,hidden:false,muted:false,locked:false},{client_id:'audio-demo',name:'AUDIO 1',type:'audio',position:1,hidden:false,muted:false,locked:false},{client_id:'text-demo',name:'TEXT 1',type:'text',position:2,hidden:false,muted:false,locked:false}] as Track[]:[]
 return <section className="timeline"><div className="timeline-toolbar"><div className="edit-tools"><label>Speed <b>1.5×</b></label><button onClick={onAdd}><Plus/></button>{menuOpen&&<div className="add-track-menu"><button onClick={()=>addTrack('video')}><Video/>Video track</button><button onClick={()=>addTrack('audio')}><Music2/>Audio track</button><button onClick={()=>addTrack('text')}><TextCursorInput/>Text track</button></div>}<button><Scissors/></button><button><SlidersHorizontal/></button></div><div className="ruler" onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setPlayhead(((e.clientX-r.left)/r.width)*90)}}>{ruler.map(t=><span key={t} style={{left:`${(t/90)*100}%`}}>{formatTime(t)}</span>)}</div></div><div className="track-stack"><div className="playhead" style={{left:`calc(17% + ${(playhead/90)*81}%)`}}><i/></div>{shownTracks.length?shownTracks.map((track,index)=><div className="track" key={track.client_id}><div className="track-info"><div><strong className={track.type}>{track.name}</strong>{!tracks.length&&<small>DEMO</small>}</div><button onClick={()=>tracks.length&&toggle(track.client_id,'hidden')}>{track.hidden?<EyeOff/>:<Eye/>}</button><button onClick={()=>tracks.length&&toggle(track.client_id,'locked')}>{track.locked?<Lock/>:<Unlock/>}</button>{tracks.length&&<button onClick={()=>remove(track.client_id)}><Trash2/></button>}</div><div className="track-lane">{demo&&index===0&&<><div className="clip video-clip clip-a"><img src="/assets/planet-demo.png"/><b>Planet.png</b><Image/></div><div className="clip video-clip clip-b"><img src="/assets/planet-demo.png"/><b>Origin.mp4</b><Image/></div></>}{demo&&index===1&&<><div className="clip audio-clip"><div className="waveform">{Array.from({length:45},(_,i)=><i key={i} style={{height:`${12+(i*13)%28}px`}}/>)}</div><b>Intro-sound.mp3</b><Music2/></div></>}{demo&&index===2&&<><div className="clip text-clip"><b>Law Of Conservation Of Energy</b><TextCursorInput/></div><div className="clip text-clip text-end"><b>End Point Of World?</b><TextCursorInput/></div></>}</div></div>):<div className="timeline-empty"><Plus/><span>Add a track to begin editing</span></div>}</div></section>
}

function formatTime(seconds:number){return `00:${Math.floor(seconds).toString().padStart(2,'0')}`}

function ProfilePage(){const {user,refresh}=useAuth();const [name,setName]=useState(user?.display_name??'');const mutation=useMutation({mutationFn:()=>api<User>('/profile',{method:'PATCH',body:JSON.stringify({display_name:name})}),onSuccess:async()=>{await refresh()}});return <div className="app-shell"><AppHeader/><main className="settings-page"><Link to="/dashboard" className="back-link"><ArrowLeft/>Back to projects</Link><div className="settings-card"><p className="eyebrow">ACCOUNT</p><h1>Your profile</h1><form onSubmit={e=>{e.preventDefault();mutation.mutate()}}><Field label="Display name" value={name} onChange={e=>setName(e.target.value)}/><Field label="Email" value={user?.email??''} disabled/><ErrorMessage error={mutation.error}/><Button disabled={mutation.isPending}>Save profile</Button></form></div></main></div>}

function App(){return <AuthProvider><Routes><Route path="/" element={<Navigate to="/dashboard" replace/>}/><Route path="/login" element={<LoginPage/>}/><Route path="/register" element={<RegisterPage/>}/><Route path="/forgot-password" element={<ForgotPasswordPage/>}/><Route path="/reset-password" element={<ResetPasswordPage/>}/><Route path="/dashboard" element={<ProtectedRoute><DashboardPage/></ProtectedRoute>}/><Route path="/projects/:id/editor" element={<ProtectedRoute><EditorPage/></ProtectedRoute>}/><Route path="/profile" element={<ProtectedRoute><ProfilePage/></ProtectedRoute>}/><Route path="*" element={<Navigate to="/dashboard" replace/>}/></Routes></AuthProvider>}
export default App
