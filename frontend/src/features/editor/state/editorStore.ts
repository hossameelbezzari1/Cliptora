import { create } from 'zustand'

type EditorStore={playhead:number;selectedTrack:string|null;demo:boolean;setPlayhead:(v:number)=>void;select:(id:string|null)=>void;toggleDemo:()=>void}
export const useEditor=create<EditorStore>(set=>({playhead:0,selectedTrack:null,demo:false,setPlayhead:playhead=>set({playhead}),select:selectedTrack=>set({selectedTrack}),toggleDemo:()=>set(s=>({demo:!s.demo}))}))
