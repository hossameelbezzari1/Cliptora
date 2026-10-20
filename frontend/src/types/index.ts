export type User = {id:number; email:string; display_name:string; created_at:string}
export type Project = {id:number; name:string; width:number; height:number; fps:number; revision:number; created_at:string; updated_at:string}
export type MediaAsset = {id:number; name:string; kind:'video'|'image'|'audio'; mime:string; size_bytes:number; created_at:string}
export type Clip = {client_id:string; name:string; type:'video'|'image'|'audio'|'text'; start:number; duration:number; source_offset:number; media_id:number|null; text:string|null; color:string}
export type Track = {client_id:string; name:string; type:'video'|'audio'|'text'; position:number; hidden:boolean; muted:boolean; locked:boolean; clips:Clip[]}
export type Timeline = {revision:number;tracks:Track[]}
export type AIScript = {id:number;project_id:number;name:string;instructions:string;created_at:string}
export type Scene = {start:number;end:number;reason?:string}
