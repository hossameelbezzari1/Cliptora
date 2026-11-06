
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  Navigate,
  useLocation,
} from 'react-router-dom'

import {
  api,
  ApiError,
  resetCsrf,
} from '../lib/api'

import type { User } from '../types'

type AuthValue = {
  user: User | null
  loading: boolean
  refresh: () => Promise<User | null>
  logout: () => Promise<void>
}

const Context = createContext<AuthValue | null>(null)

export function AuthProvider({
  children,
}: {
  children: ReactNode
}) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const requestId = useRef(0)

  const refresh = useCallback(async (): Promise<User | null> => {
    const currentRequest = ++requestId.current

    try {
      const authenticatedUser = await api<User>('/auth/me')

      if (
        !authenticatedUser ||
        typeof authenticatedUser.id !== 'number' ||
        typeof authenticatedUser.email !== 'string'
      ) {
        throw new Error(
          'Authentication API returned an invalid user response.'
        )
      }

      if (currentRequest === requestId.current) {
        setUser(authenticatedUser)
      }

      return authenticatedUser
    } catch (error) {
      if (currentRequest === requestId.current) {
        setUser(null)
      }

      if (error instanceof ApiError && error.status === 401) {
        return null
      }

      throw error
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      console.error('CLIPTORA authentication error:', error)
    })
  }, [refresh])

  const logout = useCallback(async (): Promise<void> => {
    await api('/auth/logout', {
      method: 'POST',
    })

    requestId.current += 1

    resetCsrf()
    setUser(null)
    setLoading(false)
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      refresh,
      logout,
    }),
    [user, loading, refresh, logout]
  )

  return (
    <Context.Provider value={value}>
      {children}
    </Context.Provider>
  )
}

export function useAuth(): AuthValue {
  const context = useContext(Context)

  if (!context) {
    throw new Error('AuthProvider missing')
  }

  return context
}

export function Protected({
  children,
}: {
  children: ReactNode
}) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-cl-bg dark:bg-cl-dark-bg text-cl-muted dark:text-cl-dark-muted">
        <div className="loading-pulse text-xl">
          Loading Cliptora…
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        state={{
          from: location.pathname,
        }}
        replace
      />
    )
  }

  return <>{children}</>
}
