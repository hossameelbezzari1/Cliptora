import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { api, ApiError, resetCsrf } from '../lib/api'
import type { User } from '../types'

type AuthValue = {user:User|null;loading:boolean;refresh:()=>Promise<void>;logout:()=>Promise<void>}
const Context=createContext<AuthValue|null>(null)
export function AuthProvider({children}:{children:ReactNode}){
 const [user,setUser]=useState<User|null>(null)
 const [loading,setLoading]=useState(true)
 const refresh=useCallback(async()=>{
   try{setUser(await api<User>('/auth/me'))}
   catch(err){if(err instanceof ApiError && err.status===401)setUser(null);else setUser(null)}
   finally{setLoading(false)}
 },[])
 useEffect(()=>{void refresh()},[refresh])
 const logout=useCallback(async()=>{await api('/auth/logout',{method:'POST'});resetCsrf();setUser(null)},[])
 const value=useMemo(()=>({user,loading,refresh,logout}),[user,loading,refresh,logout])
 return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useAuth(){const v=useContext(Context);if(!v)throw new Error('AuthProvider missing');return v}
export function Protected({children}:{children:ReactNode}){
 const {user,loading}=useAuth();const location=useLocation()
 if(loading)return <div className="grid min-h-screen place-items-center bg-cl-bg text-cl-muted"><div className="loading-pulse text-xl">Loading Cliptora…</div></div>
 if(!user)return <Navigate to="/login" state={{from:location.pathname}} replace/>
 return children
}
