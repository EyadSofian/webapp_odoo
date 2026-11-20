import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { sessionStore, logout as apiLogout } from './api'
import { stopHub } from './hub'
import { disablePush } from './push'
import type { SessionUser } from './types'

interface Auth {
  user: SessionUser | null
  signOut: () => Promise<void>
}

const Ctx = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => sessionStore.get()?.user ?? null)
  const queryClient = useQueryClient()

  useEffect(() => sessionStore.subscribe((s) => {
    setUser(s?.user ?? null)
    if (!s) {
      queryClient.clear()
      void stopHub()
    }
  }), [queryClient])

  const signOut = async () => {
    await disablePush().catch(() => undefined)
    await apiLogout()
  }

  return <Ctx.Provider value={{ user, signOut }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth outside provider')
  return ctx
}
