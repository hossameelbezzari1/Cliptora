import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

type Listener = () => void
export class QueryClient {
  cache = new Map<string, unknown>()
  listeners = new Map<string, Set<Listener>>()
  constructor(_options?: unknown) {}
  key(queryKey: readonly unknown[]) { return JSON.stringify(queryKey) }
  notify(key: string) { this.listeners.get(key)?.forEach(fn => fn()) }
  setQueryData<T>(queryKey: readonly unknown[], value: T) { const key=this.key(queryKey); this.cache.set(key,value); this.notify(key) }
  invalidateQueries({queryKey}:{queryKey:readonly unknown[]}) { const prefix=JSON.stringify(queryKey).slice(0,-1); for(const key of this.cache.keys()) if(key.startsWith(prefix)){this.cache.delete(key);this.notify(key)} }
  clear(){this.cache.clear();this.listeners.forEach(set=>set.forEach(fn=>fn()))}
}
const QueryContext=createContext<QueryClient|null>(null)
export function QueryClientProvider({client,children}:{client:QueryClient;children:ReactNode}){return <QueryContext.Provider value={client}>{children}</QueryContext.Provider>}
export function useQueryClient(){const client=useContext(QueryContext);if(!client)throw new Error('Query client missing');return client}

export function useQuery<T>({queryKey,queryFn,enabled=true}:{queryKey:readonly unknown[];queryFn:()=>Promise<T>;enabled?:boolean}){
  const client=useQueryClient(); const key=client.key(queryKey); const cached=client.cache.get(key) as T|undefined
  const [data,setData]=useState<T|undefined>(cached); const [error,setError]=useState<unknown>(null); const [isLoading,setLoading]=useState(enabled&&!cached)
  const queryFnRef=useRef(queryFn); queryFnRef.current=queryFn
  const refetch=useCallback(async()=>{if(!enabled)return {data:undefined};setLoading(true);setError(null);try{const value=await queryFnRef.current();client.cache.set(key,value);setData(value);return {data:value}}catch(reason){setError(reason);throw reason}finally{setLoading(false)}},[key,enabled])
  useEffect(()=>{const update=()=>{const value=client.cache.get(key) as T|undefined;setData(value);if(value===undefined&&enabled)void refetch().catch(()=>{})};const set=client.listeners.get(key)??new Set();set.add(update);client.listeners.set(key,set);if(enabled&&client.cache.get(key)===undefined)void refetch().catch(()=>{});return()=>{set.delete(update)}},[key,enabled,refetch])
  return {data,error,isLoading,refetch}
}

export function useMutation<TData=unknown,TVariables=void>({mutationFn,onSuccess,onError}:{mutationFn:(variables:TVariables)=>Promise<TData>;onSuccess?:(data:TData)=>void|Promise<void>;onError?:(error:unknown)=>void}){
  const [isPending,setPending]=useState(false);const [error,setError]=useState<unknown>(null)
  const mutate=useCallback((variables?:TVariables)=>{setPending(true);setError(null);void mutationFn(variables as TVariables).then(async data=>{await onSuccess?.(data)}).catch(reason=>{setError(reason);onError?.(reason)}).finally(()=>setPending(false))},[mutationFn,onSuccess,onError])
  return {mutate,isPending,error}
}
