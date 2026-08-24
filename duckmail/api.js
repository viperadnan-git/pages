// DuckDuckGo Email Protection API.
//
// quack.duckduckgo.com sends no Access-Control-Allow-* headers and answers
// OPTIONS preflight with 403, so every call goes through a CORS proxy.
// POST /email/addresses also 403s unless a browser User-Agent is forwarded;
// JS cannot set that header, so the proxy has to pass the client's through.

const BASE = 'https://quack.duckduckgo.com/api'
export const DEFAULT_PROXY = 'https://cors.viperadnan.com/?url='

export class ApiError extends Error {
  constructor(status, body) {
    super(messageFor(status, body))
    this.status = status
    this.body = body
  }
}

function messageFor(status, body) {
  if (body && body.error === 'invalid_token') return 'Token rejected. Sign in again to get a new one.'
  switch (status) {
    case 401: return 'Token rejected. Sign in again to get a new one.'
    case 403: return 'DuckDuckGo refused the request. The proxy may not be forwarding the browser User-Agent.'
    case 429: return 'Too many requests. Wait a minute and try again.'
    case 0: return 'Cannot reach the proxy. Check your connection or set a different proxy in Settings.'
    default: return `Request failed (${status}).`
  }
}

async function call(proxy, path, { method = 'GET', token, params } = {}) {
  const target = new URL(BASE + path)
  for (const [k, v] of Object.entries(params || {})) target.searchParams.set(k, v)

  let res
  try {
    res = await fetch(proxy + encodeURIComponent(target.toString()), {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  } catch {
    throw new ApiError(0)
  }

  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { /* non-JSON bodies stay null */ }
  if (!res.ok) throw new ApiError(res.status, body)
  return body
}

/** Aliases come back bare from some fields and qualified from others. */
const asEmail = (a) => (String(a).includes('@') ? String(a) : `${a}@duck.com`)

/** Emails a one-time passphrase. Returns 200 even for unknown usernames. */
export const requestPassphrase = (proxy, username) =>
  call(proxy, '/auth/loginlink', { params: { user: username } })

/**
 * Trades the passphrase for a short-lived token, then spends it on the one
 * call that accepts it. The permanent access_token lives in the dashboard
 * body — that is the token everything else uses, and the only one worth
 * storing. The login token is discarded here.
 */
export async function signIn(proxy, username, passphrase) {
  const { token } = await call(proxy, '/auth/login', {
    params: { user: username, otp: passphrase.trim() },
  }) || {}
  if (!token) throw new Error('Wrong passphrase. Check the email and try again.')

  const dashboard = await call(proxy, '/email/dashboard', { token })
  const user = dashboard && dashboard.user
  if (!user || !user.access_token) throw new Error('DuckDuckGo returned no access token.')

  return {
    username: user.username || username,
    token: user.access_token,
    cohort: user.cohort || '',
    forwarding: user.email || '',
    generated: (dashboard.stats && dashboard.stats.addresses_generated) || 0,
    // an address already minted and waiting; DuckDuckGo's own page shows this
    // one on load rather than making you generate first
    nextAlias: user.next_alias ? asEmail(user.next_alias) : '',
    // Undocumented and empty as far as anyone can tell — DuckDuckGo's own page
    // never reads it — but if the server does return the account's aliases,
    // they are worth having.
    addresses: Array.isArray(dashboard.addresses) ? dashboard.addresses.map(asEmail) : [],
  }
}

/** Mints a new @duck.com alias. Takes the permanent token. */
export async function generate(proxy, token) {
  const { address } = await call(proxy, '/email/addresses', { method: 'POST', token }) || {}
  if (!address) throw new Error('DuckDuckGo returned no address.')
  return `${address}@duck.com`
}
