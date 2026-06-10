import { create } from 'zustand'

const ACCESS_KEY = 'tsm.access'
const REFRESH_KEY = 'tsm.refresh'

function readToken(key) {
  return sessionStorage.getItem(key) || localStorage.getItem(key)
}

function writeToken(key, value) {
  sessionStorage.setItem(key, value)
  localStorage.removeItem(key)
}

const _getAccess  = () => readToken(ACCESS_KEY)
const _getRefresh = () => readToken(REFRESH_KEY)

export const useAuthStore = create((set, get) => ({
  user: null,
  accessToken: _getAccess(),
  refreshToken: _getRefresh(),
  isAuthenticated: !!_getAccess(),

  setTokens: (access, refresh) => {
    writeToken(ACCESS_KEY, access)
    writeToken(REFRESH_KEY, refresh)
    set({ accessToken: access, refreshToken: refresh, isAuthenticated: true })
  },

  setUser: (user) => set({ user }),

  logout: () => {
    sessionStorage.removeItem(ACCESS_KEY)
    sessionStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
    set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false })
  },

  hasPermission: (key) => {
    const { user } = get()
    if (!user) return false
    if (user.role === 'admin' || user.role === 'leadership') return true
    return user.permissions?.[key] === true
  },
}))

// Internal use — api/index.js ke liye
export const _getStoredAccess  = _getAccess
export const _getStoredRefresh = _getRefresh
export const _setStoredAccess  = (v) => writeToken(ACCESS_KEY, v)
export const _clearStorage     = () => {
  sessionStorage.removeItem(ACCESS_KEY)
  sessionStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
}
