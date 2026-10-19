import { AudioLines, Bot, FolderOpen, Mic2, Shapes, Sparkles, WandSparkles, Variable, Move3D } from 'lucide-react'

export const libraryItems = [
  {id:'media',icon:FolderOpen,label:'Media'},
  {id:'components',icon:Shapes,label:'Components'},
  {id:'ai',icon:Bot,label:'AI Scripts'},
  {id:'variables',icon:Variable,label:'Variables'},
  {id:'effects',icon:WandSparkles,label:'Effects'},
  {id:'transitions',icon:Sparkles,label:'Transitions'},
  {id:'animations',icon:Move3D,label:'Animations'},
  {id:'audio',icon:Mic2,label:'Audio'},
] as const
