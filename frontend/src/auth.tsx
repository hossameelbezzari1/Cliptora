import { createContext, useContext, type ReactNode } from 'react'
import { useQuery, useQueryClient } from './query'
import { Navigate, useLocation } from 'react-router-dom'
import { api, clearCsrf } from './api'
import type { User } from './types'

type AuthValue = { user: User | null; loading: boolean; refresh: () => Promise<unknown>; logout: () => Promise<void> }
const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/auth/me') })
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' })
    clearCsrf()
    client.setQueryData(['me'], null)
    client.clear()
  }
  return <AuthContext.Provider value={{ user: query.data ?? null, loading: query.isLoading, refresh: query.refetch, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('AuthProvider missing'); return value }
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth(); const location = useLocation()
  if (loading) return <div className="page-loader"><span /></div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}
