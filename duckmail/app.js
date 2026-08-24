import * as api from './api.js'
import * as db from './store.js'

const $ = (id) => document.getElementById(id)
const state = db.state

let latest = null   // the address on the LCD right now
let pending = null  // username awaiting a passphrase
let scope = ''      // address-list filter; '' is every account
let clearScope = '' // which addresses the Clear tab will delete

// --- chrome ----------------------------------------------------------------

/**
 * The one confirmation dialog. Resolves to null when dismissed, otherwise to
 * `{ checked }` so a caller can fold a single follow-up choice into the same
 * step instead of stacking a second prompt.
 */
function ask({ title, body, action = 'Confirm', danger = false, option }) {
  const dialog = $('confirm')
  const go = $('cf-go')
  $('cf-title').textContent = title
  $('cf-body').textContent = body
  $('cf-option').hidden = !option
  if (option) {
    $('cf-check').checked = !!option.checked
    $('cf-check-label').textContent = option.label
  }
  go.textContent = action
  go.classList.toggle('danger', danger)
  dialog.showModal()
  go.focus()

  return new Promise((resolve) => {
    const onDismiss = () => resolve(null)
    const onConfirm = () => {
      dialog.removeEventListener('close', onDismiss)
      dialog.close()
      resolve({ checked: $('cf-check').checked })
    }
    go.addEventListener('click', onConfirm, { once: true })
    dialog.addEventListener('close', onDismiss, { once: true })
  })
}

db.handleSaveError((message) => toast(message))

function toast(message) {
  const el = $('toast')
  el.textContent = message
  // drop it back and force a reflow so a repeat copy replays the slide-in
  // instead of silently resetting the timer on an already-raised toast
  el.classList.remove('up')
  void el.offsetWidth
  el.classList.add('up')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => el.classList.remove('up'), 2200)
}

function applyTheme() {
  const theme = state.settings.theme
  document.documentElement.dataset.theme = theme === 'system' ? '' : theme
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  for (const b of $('theme').children) b.setAttribute('aria-pressed', String(b.dataset.theme === theme))
}

$('theme').addEventListener('click', (e) => {
  const button = e.target.closest('button')
  if (!button) return
  db.setSetting('theme', button.dataset.theme)
  applyTheme()
})

function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`
  return new Date(ts).toLocaleDateString()
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Copied')
  } catch {
    toast('Copy failed — select the address instead')
  }
}

// --- rendering --------------------------------------------------------------

function render() {
  const account = db.currentAccount()

  $('channels').innerHTML = state.accounts
    .map((a) => `<button class="channel" data-user="${esc(a.username)}"
        aria-pressed="${a.username === state.current}"
        title="${esc(a.label || a.username)}@duck.com"><span class="name">${esc(a.label || a.username)}</span></button>`)
    .join('') + '<button class="channel add" id="add-account" title="Add an account" aria-label="Add an account">+</button>'

  // keep the selected account in view when the strip scrolls
  const active = $('channels').querySelector('[aria-pressed=true]')
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  markStripEdges()

  $('identity').innerHTML = account
    ? `<button class="who" type="button" data-copy="${esc(account.username)}@duck.com"
         title="Copy to clipboard">${esc(account.username)}@duck.com</button>
       <span class="meta">${account.forwarding ? `Forwards to ${esc(account.forwarding)}` : 'Signed in'}</span>
       <span class="meta">${account.token ? '' : 'No token — sign in again to generate addresses.'}</span>`
    : '<span class="meta">No account yet. Press + to sign in with your Duck username.</span>'

  // a lifetime generation count belongs with the generator, not the identity
  $('lcd-count').textContent = account ? `${account.generated || 0} generated` : ''

  $('generate').disabled = !account || !account.token

  // addresses outlive the account that made them, so signed-out accounts stay
  // selectable — otherwise their addresses could never be found or removed
  const options = accountOptions()
  if (scope && !options.some(([value]) => value === scope)) scope = ''
  paintSelect($('scope'), options, scope)

  renderList()
}

function renderList() {
  const q = $('search').value.trim().toLowerCase()
  // numbered over the account scope, not the search results, so a row keeps the
  // same number whatever you type
  const scoped = state.addresses.filter((a) => !scope || a.account === scope)
  const numberOf = new Map(scoped.map((a, i) => [a.address, scoped.length - i]))
  const rows = scoped.filter((a) =>
    !q || a.address.toLowerCase().includes(q) || (a.note || '').toLowerCase().includes(q))

  $('count').textContent = rows.length ? `· ${rows.length}` : ''
  $('list').innerHTML = rows.length
    ? rows.map((a) => `<li class="item">
        <span class="num">#${numberOf.get(a.address)}</span>
        <button class="addr" type="button" data-copy="${esc(a.address)}" title="Copy to clipboard">${esc(a.address)}</button>
        <span class="when">${scope ? '' : `<span class="owner">${esc(ownerName(a.account))}</span> · `}${ago(a.createdAt)}</span>
        <button class="btn small" data-copy="${esc(a.address)}">Copy</button>
        <button class="btn small" data-note="${esc(a.address)}">${a.note ? 'Edit note' : 'Note'}</button>
        <span class="note">${esc(a.note || '')}</span>
      </li>`).join('')
    : `<li class="empty">${state.addresses.length
        ? 'Nothing matches that search.'
        : 'Addresses you generate here will be listed, newest first.'}</li>`
}

/** Display name for an address's account, signed in or not. */
function ownerName(username) {
  const account = db.accountFor(username)
  return account ? account.label || account.username : username
}

/** Accounts that still own addresses but are no longer signed in. */
function orphanNames() {
  const known = new Set(state.accounts.map((a) => a.username))
  return [...new Set(state.addresses.map((a) => a.account))].filter((n) => n && !known.has(n))
}

const orphanCount = () => {
  const names = orphanNames()
  return state.addresses.filter((a) => names.includes(a.account)).length
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function showLatest(address) {
  latest = address
  $('lcd').textContent = address || 'Press new address'
  $('lcd').classList.toggle('idle', !address)
  $('copy-latest').disabled = !address
  $('note-latest').disabled = !address
}

/** Newest address on record for an account, so the readout is never blank
    when one exists. */
function showLatestFor(username) {
  const recent = state.addresses.find((a) => a.account === username)
  showLatest(recent ? recent.address : null)
}

function markStripEdges() {
  const strip = $('channels')
  const left = strip.scrollLeft > 4
  const right = strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 4
  strip.dataset.more = left && right ? 'both' : left ? 'left' : right ? 'right' : ''
}

$('channels').addEventListener('scroll', markStripEdges, { passive: true })
addEventListener('resize', markStripEdges)

// --- generate ---------------------------------------------------------------

$('generate').addEventListener('click', async () => {
  const account = db.currentAccount()
  if (!account || !account.token) return
  const knob = $('generate')
  knob.disabled = true
  knob.innerHTML = '<span>···</span>'
  try {
    const address = await api.generate(state.settings.proxy, account.token)
    db.recordAddress(address, account.username)
    showLatest(address)
    render()
    copy(address)
  } catch (err) {
    if (err.status === 401) { db.clearToken(account.username); render() }
    toast(err.message)
  } finally {
    knob.disabled = false
    knob.innerHTML = '<span>New</span><span>address</span>'
    render()
  }
})

$('lcd').addEventListener('click', () => latest && copy(latest))
$('copy-latest').addEventListener('click', () => latest && copy(latest))
$('note-latest').addEventListener('click', () => latest && editNote(latest))

let noting = null   // address whose note is open

function editNote(address) {
  const entry = state.addresses.find((a) => a.address === address)
  if (!entry) return
  noting = address
  $('nt-address').textContent = address
  $('nt-text').value = entry.note || ''
  $('note').showModal()
  $('nt-text').focus()
}

function saveNote(text) {
  if (db.setNote(noting, text)) renderList()
  $('note').close()
  toast(text.trim() ? 'Note saved' : 'Note cleared')
}

$('nt-save').addEventListener('click', () => saveNote($('nt-text').value))
$('nt-clear').addEventListener('click', () => saveNote(''))

// ⌘/Ctrl+Enter saves, matching the button rather than adding a newline
$('nt-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote($('nt-text').value)
})

$('identity').addEventListener('click', (e) => {
  const button = e.target.closest('[data-copy]')
  if (button) copy(button.dataset.copy)
})

$('list').addEventListener('click', (e) => {
  const button = e.target.closest('button')
  if (!button) return
  if (button.dataset.copy) copy(button.dataset.copy)
  if (button.dataset.note) editNote(button.dataset.note)
})

$('search').addEventListener('input', renderList)

// --- dropdown ---------------------------------------------------------------

/** Behaviour for one custom listbox. Options are painted separately so each
    instance can source its own. */
function wireSelect(root, onPick) {
  const menu = root.querySelector('.menu')
  const trigger = root.querySelector('.trigger')

  const setOpen = (open) => {
    menu.hidden = !open
    root.toggleAttribute('data-open', open)
    trigger.setAttribute('aria-expanded', String(open))
    if (open) {
      const target = menu.querySelector('[aria-selected=true]') || menu.firstElementChild
      if (target) target.focus()
    }
  }

  trigger.addEventListener('click', () => setOpen(menu.hidden))

  menu.addEventListener('click', (e) => {
    const option = e.target.closest('button')
    if (!option) return
    setOpen(false)
    trigger.focus()
    onPick(option.dataset.value)
  })

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (menu.hidden) return          // let the dialog handle it
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      trigger.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    if (menu.hidden) return setOpen(true)
    const options = [...menu.children]
    const next = options.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1)
    ;(options[next] || options[e.key === 'ArrowDown' ? 0 : options.length - 1]).focus()
  })

  document.addEventListener('click', (e) => {
    if (!menu.hidden && !root.contains(e.target)) setOpen(false)
  })
}

function paintSelect(root, options, value) {
  root.querySelector('.menu').innerHTML = options
    .map(([v, name]) => `<button type="button" role="option" data-value="${esc(v)}"
        aria-selected="${v === value}">${esc(name)}</button>`).join('')
  root.querySelector('.trigger span').textContent =
    (options.find(([v]) => v === value) || options[0])[1]
}

/** Every account that owns addresses, signed in or not. */
function accountOptions() {
  return [
    ['', 'All accounts'],
    ...state.accounts.map((a) => [a.username, a.label || a.username]),
    ...orphanNames().map((name) => [name, `${name} (signed out)`]),
  ]
}

wireSelect($('scope'), (value) => { scope = value; render() })
wireSelect($('clear-scope'), (value) => { clearScope = value; refreshSettings() })

// --- accounts ---------------------------------------------------------------

$('channels').addEventListener('click', (e) => {
  const button = e.target.closest('button')
  if (!button) return
  if (button.id === 'add-account') return openSignIn()
  db.selectAccount(button.dataset.user)
  showLatestFor(state.current)
  render()
})

/** Step 1 asks for the username, step 2 replaces it with the passphrase —
    the fields swap rather than stack. */
function signInStep(step) {
  const asking = step === 'passphrase'
  $('si-user-wrap').hidden = asking
  $('si-otp-wrap').hidden = !asking
  $('si-hint').textContent = asking
    ? `Check the inbox that ${pending}@duck.com forwards to.`
    : 'DuckDuckGo emails a passphrase to your forwarding address.'
  $('si-go').textContent = asking ? 'Sign in' : 'Send passphrase'
  $('si-paste').textContent = asking ? 'Start over' : 'Paste a token'
  ;(asking ? $('si-otp') : $('si-user')).focus()
}

function openSignIn() {
  pending = null
  $('si-user').value = ''
  $('si-otp').value = ''
  $('si-alert').textContent = ''
  $('si-alert').className = 'alert'
  $('signin').showModal()
  signInStep('username')
}

$('si-go').addEventListener('click', async () => {
  const alert = $('si-alert')
  const username = $('si-user').value.trim().replace(/@duck\.com$/i, '')
  if (!username) return
  const go = $('si-go')
  go.disabled = true
  try {
    if (!pending) {
      await api.requestPassphrase(state.settings.proxy, username)
      pending = username
      signInStep('passphrase')
      alert.className = 'alert ok'
      alert.textContent = 'Passphrase sent. It expires shortly, so use it now.'
    } else {
      const passphrase = $('si-otp').value.trim()
      if (!passphrase) throw new Error('Enter the passphrase from the email.')
      const { nextAlias, addresses, ...account } = await api.signIn(state.settings.proxy, pending, passphrase)
      db.addAccount(account)
      for (const address of addresses) db.recordAddress(address, account.username, { count: false })
      if (nextAlias) db.recordAddress(nextAlias, account.username, { count: false })
      $('signin').close()
      showLatest(nextAlias || null)
      render()
      toast(`Signed in as ${account.username}`)
    }
  } catch (err) {
    alert.className = 'alert'
    alert.textContent = err.message
  } finally {
    go.disabled = false
  }
})

$('si-paste').addEventListener('click', () => {
  if (pending) {                    // acting as "Start over"
    pending = null
    $('si-otp').value = ''
    $('si-alert').textContent = ''
    $('si-alert').className = 'alert'
    return signInStep('username')
  }
  $('signin').close()
  $('tk-user').value = ''
  $('tk-token').value = ''
  $('tk-alert').textContent = ''
  $('token').showModal()
})

$('tk-go').addEventListener('click', () => {
  const username = $('tk-user').value.trim().replace(/@duck\.com$/i, '')
  const token = $('tk-token').value.trim()
  if (!username || !token) {
    $('tk-alert').textContent = 'Both fields are required.'
    return
  }
  db.addAccount({ username, token, generated: 0 })
  $('token').close()
  showLatestFor(state.current)
  render()
  toast(`Added ${username}`)
})

// --- backup -----------------------------------------------------------------

$('bk-export').addEventListener('click', () => {
  const parts = backupParts()
  const blob = new Blob([JSON.stringify(db.buildBackup(state, parts), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `duckmail-${stamp()}.json`
  a.click()
  URL.revokeObjectURL(url)
  toast(parts.accounts ? 'Downloaded — contains access tokens' : 'Downloaded')
})

$('rs-pick').addEventListener('click', () => $('rs-file').click())

$('rs-file').addEventListener('change', async (e) => {
  const file = e.target.files[0]
  if (!file) return
  e.target.value = ''
  const alert = $('rs-alert')
  const mode = document.querySelector('input[name=rs-mode]:checked').value
  try {
    const backup = JSON.parse(await file.text())
    if (mode === 'replace') {
      const go = await ask({
        title: 'Replace everything?',
        body: 'Every account, token, and address in this browser will be discarded and rebuilt from this file.',
        action: 'Replace',
        danger: true,
      })
      if (!go) return
    }
    const result = db.applyBackup(state, backup, mode)
    db.replaceState(result.state)
    if (result.proxy) {
      const go = await ask({
        title: 'Use the proxy from this file?',
        body: `The backup points at ${result.proxy}. A proxy relays every request and sees your access tokens, so only accept one you run or trust. Declining keeps your current proxy.`,
        action: 'Use it',
      })
      if (go) db.setSetting('proxy', result.proxy)
    }
    applyTheme()
    showLatestFor(state.current)
    render()
    alert.className = 'alert ok'
    alert.textContent = `Restored: ${result.newAccounts} accounts, ${result.newAddresses} addresses added.`
  } catch (err) {
    alert.className = 'alert'
    alert.textContent = err.message
  }
})

// --- settings and clearing --------------------------------------------------

const backupParts = () => ({
  accounts: $('bk-accounts').checked,
  addresses: $('bk-addresses').checked,
  notes: $('bk-notes').checked,
  settings: $('bk-settings').checked,
})

function checkBackupCoverage() {
  const parts = backupParts()
  const missing = ['accounts', 'addresses', 'notes', 'settings'].filter((key) => !parts[key])
  // notes alone describe nothing, so a file with no accounts and no addresses
  // has nothing to restore
  const empty = !parts.accounts && !parts.addresses
  const warn = $('bk-warn')

  $('bk-export').disabled = empty
  warn.className = empty || missing.length ? 'alert' : 'alert ok'
  warn.textContent = empty
    ? 'Pick accounts or addresses — there is nothing to back up otherwise.'
    : missing.length
      ? `Restoring this file will not bring back: ${missing.join(', ')}.`
      : 'Restores this browser exactly as it is now.'
}

for (const box of ['bk-accounts', 'bk-addresses', 'bk-notes', 'bk-settings'])
  $(box).addEventListener('change', checkBackupCoverage)

const settingsTabs = $('settings').querySelector('.tabs')

function showTab(name) {
  for (const tab of settingsTabs.children) tab.setAttribute('aria-selected', String(tab.dataset.tab === name))
  for (const panel of $('settings').querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== name
}

settingsTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('button')
  if (tab) showTab(tab.dataset.tab)
})

/** Settings shows live counts, so it has to be redrawn after every action
    taken inside it, not only when it opens. */
/** Local time, seconds included so two backups a minute apart never collide. */
function stamp(at = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 'es'}`

function refreshSettings() {
  $('st-proxy').value = state.settings.proxy
  const account = db.currentAccount()
  $('st-session').textContent = account
    ? `Signed in as ${account.username}@duck.com. Logging out keeps this account's saved addresses.`
    : 'No account signed in.'
  $('st-logout').disabled = !account
  $('st-clear-addresses').disabled = !account

  const options = accountOptions()
  if (clearScope && !options.some(([value]) => value === clearScope)) clearScope = ''
  paintSelect($('clear-scope'), options, clearScope)

  const button = $('st-clear-addresses')
  const count = addressesIn(clearScope).length
  button.disabled = !count
  button.textContent = count ? `Delete ${plural(count, 'address')}` : 'No addresses'
}

const addressesIn = (username) =>
  state.addresses.filter((a) => !username || a.account === username)

$('settings-open').addEventListener('click', () => {
  refreshSettings()
  $('st-alert').textContent = ''
  $('rs-alert').textContent = ''
  checkBackupCoverage()
  showTab('general')
  $('settings').showModal()
})

$('st-proxy').addEventListener('change', () => {
  const proxy = $('st-proxy').value.trim() || api.DEFAULT_PROXY
  if (!db.isSafeProxy(proxy)) {
    $('st-proxy').value = state.settings.proxy
    $('st-alert').className = 'alert'
    $('st-alert').textContent = 'A proxy must be an https address — it carries your access token.'
    return
  }
  db.setSetting('proxy', proxy)
  $('st-proxy').value = proxy
  toast('Proxy saved')
})

const needsAccount = () => {
  const account = db.currentAccount()
  if (!account) $('st-alert').textContent = 'No account selected.'
  return account
}

$('st-logout').addEventListener('click', async () => {
  const account = db.currentAccount()
  if (!account) return
  const go = await ask({
    title: 'Log out?',
    body: `${account.username}@duck.com will be signed out of this browser. Its saved addresses stay in the list, and the addresses keep working at DuckDuckGo.`,
    action: 'Log out',
  })
  if (!go) return
  db.removeAccount(account.username, { keepAddresses: true })
  showLatestFor(state.current)
  render()
  refreshSettings()
  $('st-alert').className = 'alert ok'
  $('st-alert').textContent = `Logged out of ${account.username}.`
  toast('Logged out')
})

$('st-clear-addresses').addEventListener('click', async () => {
  const doomed = addressesIn(clearScope)
  if (!doomed.length) return
  const whose = clearScope
    ? `${clearScope}${db.accountFor(clearScope) ? '' : ' (signed out)'}`
    : 'every account'
  const go = await ask({
    title: 'Delete saved addresses?',
    body: `${plural(doomed.length, 'address')} for ${whose} will be removed from this browser. They keep working at DuckDuckGo — this only forgets the record.`,
    action: `Delete ${doomed.length}`,
    danger: true,
  })
  if (!go) return
  db.removeAddresses((a) => doomed.includes(a))
  showLatestFor(state.current)
  render()
  refreshSettings()
  $('st-alert').className = 'alert ok'
  $('st-alert').textContent = `Deleted ${plural(doomed.length, 'address')}.`
})

$('st-remove-account').addEventListener('click', async () => {
  const account = needsAccount()
  if (!account) return
  const go = await ask({
    title: 'Remove this account?',
    body: `${account.username}@duck.com and its access token will be deleted from this browser.`,
    action: 'Remove',
    danger: true,
    option: { label: 'Keep its saved addresses in the list', checked: true },
  })
  if (!go) return
  db.removeAccount(account.username, { keepAddresses: go.checked })
  showLatestFor(state.current)
  render()
  refreshSettings()
  $('st-alert').className = 'alert ok'
  $('st-alert').textContent = 'Account removed.'
})

$('st-wipe').addEventListener('click', async () => {
  const go = await ask({
    title: 'Erase everything?',
    body: `Every account, access token, address, and note in this browser will be deleted. This cannot be undone — download a backup first if you need one. Your DuckDuckGo accounts and their aliases are not touched.`,
    action: 'Erase everything',
    danger: true,
  })
  if (!go) return
  db.wipe()
  scope = ''
  $('search').value = ''
  clearScope = ''
  $('search').value = ''
  latest = null
  applyTheme()
  showLatestFor(state.current)
  render()
  refreshSettings()
  $('st-alert').className = 'alert ok'
  $('st-alert').textContent = 'Everything erased.'
})

// Clicking the backdrop dismisses. The mousedown check stops a drag that
// started inside the dialog from closing it when the pointer lands outside.
for (const dialog of document.querySelectorAll('dialog')) {
  let fromBackdrop = false
  dialog.addEventListener('mousedown', (e) => { fromBackdrop = e.target === dialog })
  dialog.addEventListener('click', (e) => {
    if (fromBackdrop && e.target === dialog) dialog.close()
  })
}

// --- boot -------------------------------------------------------------------

applyTheme()
showLatestFor(state.current)
render()
