// Everything lives in localStorage. Addresses are kept in one flat list with
// an `account` field rather than nested per account, so "all accounts" is the
// cheap default view and removing an account can leave its aliases behind.

import { DEFAULT_PROXY } from './api.js'

const KEY = 'duckmail.v1'

export const empty = () => ({
  v: 1,
  accounts: [],
  addresses: [],
  current: null,
  settings: { theme: 'system', proxy: DEFAULT_PROXY },
})

const arrayOf = (value) => (Array.isArray(value) ? value : [])

/**
 * A proxy sees every request, Bearer token included, so only https (or a local
 * dev host) is ever accepted — including from a restored backup file.
 */
export function isSafeProxy(url) {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' ||
      (protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname))
  } catch {
    return false
  }
}

/** Hostile or half-written storage must not brick the page, so every field is
    checked rather than trusted. */
export function read(storage = localStorage) {
  const base = empty()
  try {
    const raw = storage.getItem(KEY)
    if (!raw) return base
    const data = JSON.parse(raw) || {}
    const settings = { ...base.settings, ...(data.settings || {}) }
    if (!isSafeProxy(settings.proxy)) settings.proxy = base.settings.proxy
    return {
      ...base,
      ...data,
      accounts: arrayOf(data.accounts).filter((a) => a && typeof a.username === 'string'),
      addresses: arrayOf(data.addresses).filter((a) => a && typeof a.address === 'string'),
      current: typeof data.current === 'string' ? data.current : null,
      settings,
    }
  } catch {
    return base
  }
}

/** Quota or a blocked storage API must surface, not vanish — a silent failure
    here means the user thinks an address was saved when it was not. */
let onSaveError = () => {}
export const handleSaveError = (fn) => { onSaveError = fn }

export function write(state, storage = localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(state))
    return true
  } catch {
    onSaveError('Could not save — this browser\'s storage is full or blocked.')
    return false
  }
}

export const state = read()
export const save = () => write(state)

export const accountFor = (username) => state.accounts.find((a) => a.username === username)
export const currentAccount = () => accountFor(state.current) || null

export function addAccount(account) {
  const existing = accountFor(account.username)
  if (existing) Object.assign(existing, account, { addedAt: existing.addedAt })
  else state.accounts.push({ label: '', addedAt: Date.now(), ...account })
  state.current = account.username
  save()
  return accountFor(account.username)
}

export function selectAccount(username) {
  state.current = username
  const account = accountFor(username)
  if (account) account.lastUsed = Date.now()
  save()
}

/** Called when DuckDuckGo rejects a token, so the UI stops offering to generate. */
export function clearToken(username) {
  const account = accountFor(username)
  if (!account) return
  account.token = ''
  save()
}

export function removeAccount(username, { keepAddresses }) {
  state.accounts = state.accounts.filter((a) => a.username !== username)
  if (!keepAddresses) state.addresses = state.addresses.filter((a) => a.account !== username)
  if (state.current === username) state.current = state.accounts[0] ? state.accounts[0].username : null
  save()
}

/** `count` is off for the alias that arrives with the dashboard — the stats
    figure already includes it, so counting again would double it. */
/** Deletes every address matching `pred`; returns how many went. */
export function removeAddresses(pred) {
  const before = state.addresses.length
  state.addresses = state.addresses.filter((a) => !pred(a))
  save()
  return before - state.addresses.length
}

export function setNote(address, note) {
  const entry = state.addresses.find((a) => a.address === address)
  if (!entry) return false
  entry.note = note.trim()
  save()
  return true
}

export function setSetting(key, value) {
  state.settings[key] = value
  save()
}

export function recordAddress(address, account, { count = true } = {}) {
  if (state.addresses.some((a) => a.address === address)) return
  state.addresses.unshift({ address, account, createdAt: Date.now(), note: '' })
  const acct = accountFor(account)
  if (acct) {
    if (count) acct.generated = (acct.generated || 0) + 1
    acct.lastUsed = Date.now()
  }
  save()
}

// --- backup ----------------------------------------------------------------

/**
 * An account is its access token — without one it cannot generate anything and
 * cannot be re-derived, so the two are never separated. The permanent token is
 * what goes in; the login token is never stored anywhere.
 */
export function buildBackup(src, parts) {
  const out = { app: 'duckmail', v: 1, exportedAt: new Date().toISOString() }
  if (parts.accounts) {
    out.accounts = src.accounts.map((a) => ({ ...a }))
    out.current = src.current
  }
  if (parts.addresses) {
    out.addresses = src.addresses.map(({ note, ...rest }) =>
      parts.notes ? { ...rest, note } : rest)
  }
  if (parts.settings) out.settings = src.settings
  return out
}

/**
 * Merge keeps whichever copy of an account has a token and whichever address
 * was created first; replace drops everything not in the file. Returns counts
 * so the UI can say what actually landed.
 */
export function applyBackup(src, backup, mode) {
  if (!backup || backup.app !== 'duckmail') throw new Error('Not a duckmail backup file.')

  const base = mode === 'replace' ? empty() : src
  const next = { ...empty(), ...base, settings: { ...base.settings } }

  // a backup can carry a proxy, and a proxy sees every Bearer token, so it is
  // never applied here — it is handed back for the user to accept
  const incomingProxy = backup.settings && backup.settings.proxy
  const proxy = incomingProxy && isSafeProxy(incomingProxy) && incomingProxy !== next.settings.proxy
    ? incomingProxy
    : null
  if (backup.settings && backup.settings.theme) next.settings.theme = backup.settings.theme

  const accounts = [...next.accounts]
  let newAccounts = 0
  for (const incoming of arrayOf(backup.accounts)) {
    if (!incoming || typeof incoming.username !== 'string') continue
    const at = accounts.findIndex((a) => a.username === incoming.username)
    if (at === -1) { accounts.push({ ...incoming }); newAccounts++; continue }
    const held = accounts[at]
    accounts[at] = {
      ...held,
      ...incoming,
      // counters only ever move forward, whichever copy is staler
      token: incoming.token || held.token,
      generated: Math.max(incoming.generated || 0, held.generated || 0),
      lastUsed: Math.max(incoming.lastUsed || 0, held.lastUsed || 0) || undefined,
      addedAt: Math.min(incoming.addedAt || Infinity, held.addedAt || Infinity) || undefined,
    }
  }

  const addresses = [...next.addresses]
  const seen = new Set(addresses.map((a) => a.address))
  let newAddresses = 0
  for (const incoming of arrayOf(backup.addresses)) {
    if (!incoming || typeof incoming.address !== 'string' || seen.has(incoming.address)) continue
    seen.add(incoming.address)
    // a missing timestamp would otherwise sort to 1970 and display as such
    addresses.push({ ...incoming, createdAt: Number(incoming.createdAt) || Date.now() })
    newAddresses++
  }
  addresses.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))

  next.accounts = accounts
  next.addresses = addresses
  next.current = next.current && accounts.some((a) => a.username === next.current)
    ? next.current
    : (backup.current || (accounts[0] && accounts[0].username) || null)

  return { state: next, newAccounts, newAddresses, proxy }
}

/** Leaves nothing behind: the stored key is removed, not blanked. */
export function wipe(storage = localStorage) {
  for (const key of Object.keys(storage)) {
    if (key === KEY || key.startsWith('duckmail.')) storage.removeItem(key)
  }
  Object.assign(state, empty())
  return state
}

export function replaceState(next) {
  Object.assign(state, empty(), next)
  save()
}
