export type User = { id: number; email: string; display_name: string; created_at: string }
export type Project = { id: number; name: string; width: number; height: number; aspect_ratio: string; fps: number; revision: number; created_at: string; updated_at: string }
export type Track = { id?: number; client_id: string; name: string; type: 'video' | 'audio' | 'text'; position: number; hidden: boolean; muted: boolean; locked: boolean }
export type Timeline = { revision: number; tracks: Track[] }
