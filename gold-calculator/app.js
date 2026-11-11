import { PURITY, bill, fromTotal, landed, maxNet } from './calc.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
const KEY = 'gold-calc:v1';
const f0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const f2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const f3 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const inr = (v) => (v < -0.5 ? '−' : '') + '₹' + f0.format(Math.abs(Math.round(v)));
const pct = (v) => f2.format(v) + '%';
const lakh = (v) => (v >= 1e7 ? `${f2.format(v / 1e7)} crore` : v >= 1e5 ? `${f2.format(v / 1e5)} lakh` : '');
const short = (v) => (v >= 1e5 ? `₹${lakh(v)}` : inr(v));
const num = (el) => parseFloat(String(el.value).replace(/,/g, '')) || 0;
const today = (t) => new Date(t).toDateString() === new Date().toDateString();
const day = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const when = (t) => (today(t) ? '' : `${day(t)}, `) + new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

const MAKING_KEYS = {
  pct: { vals: [5, 6, 8, 10, 12, 15, 18, 20], label: (v) => `${v}%`, hint: 'Plain 22K jewellery at local shops is usually 6% to 12%; branded stores often charge 12% to 20%. Ask if wastage is extra.' },
  gram: { vals: [300, 500, 700, 900, 1200], label: inr, hint: 'A fixed amount for every gram of gold. Machine-made chains often cost ₹300 to ₹900 a gram.' },
  flat: { vals: [500, 1000, 2000, 5000], label: inr, hint: 'One fixed amount for the whole piece.' },
};
const PANELS = ['more', 'old', 'src'];

// What value-conscious buyers pay, as % of gold value (machine-made chains 6-10%, local plain 22K
// from about 5% and 8-15% negotiable, brands 12-20%, rings and detailed work 14-25%).
const MAKING_BANDS = [
  [6, 'good', 'a very good deal; this is what plain, machine-made pieces go for'],
  [12, '', 'a fair price for plain 22K jewellery at a local shop'],
  [20, 'bad', 'on the high side, like branded stores. Ask for a lower making charge'],
  [Infinity, 'bad', 'high; only intricate, handmade or bridal pieces usually cost this much. Ask for a lower rate'],
];
const makingVerdict = (p) => MAKING_BANDS.find(([max]) => p <= max);

// Form state
const fields = [...form.querySelectorAll('[data-k]')];
const gather = () => {
  const o = {};
  for (const el of fields) if (el.type !== 'radio' || el.checked) o[el.name || el.id] = el.value;
  return o;
};
const DEFAULTS = gather();
const apply = (o) => {
  for (const el of fields) {
    const v = o[el.name || el.id];
    if (v == null) continue;
    if (el.type === 'radio') el.checked = el.value === v;
    else el.value = v;
  }
  // An unknown value leaves a radio group empty: fall back to its default.
  for (const el of fields) if (el.type === 'radio' && !form.elements[el.name].value && el.value === DEFAULTS[el.name]) el.checked = true;
};

// Only these choices are remembered; amounts and rates start fresh each visit.
const KEEP = ['karat', 'rateK', 'mode'];
const pick = (f = {}) => Object.fromEntries(KEEP.filter((k) => f[k] != null).map((k) => [k, f[k]]));
let S = {};
try { const o = JSON.parse(localStorage.getItem(KEY)) || {}; S = { f: pick(o.f), live: o.live }; } catch {}
const save = () => { if (!viewingShared) try { localStorage.setItem(KEY, JSON.stringify({ f: pick(S.f), live: S.live })); } catch {} };

// Share links: short keys, digits only, defaults left out. e.g. #k=22&w=10&r=14300-24&d=261111
const SHORT = { karat: 'k', gross: 'w', budget: 'b', wastagePct: 'wa', discountPct: 'ds', stoneWt: 'sw', stoneValue: 'sv', hallmark: 'hm', gstPct: 'gst', oldKarat: 'ok', oldWeight: 'ow', oldDeductPct: 'ol', final: 'f' };
const MODE_SUFFIX = { pct: '', gram: 'pg', flat: 'fx' };
const digits = (v) => (/^\d+(\.\d+)?$/.test(v || '') ? v : null);

// A shared link opens that bill without touching the saved one until the visitor edits it.
let viewingShared = false;
{
  const h = new URLSearchParams(location.hash.slice(1));
  const r = /^(\d+(?:\.\d+)?)(?:-(\d+))?$/.exec(h.get('r') || '');
  const rk = r?.[2] || '22';
  if (r && PURITY[rk] && +r[1] > 0) {
    const f = { ...DEFAULTS, rateK: rk };
    for (const [name, key] of Object.entries(SHORT)) if (digits(h.get(key))) f[name] = h.get(key);
    f.mode = h.has('b') ? 'budget' : h.has('f') ? 'check' : 'price';
    const ma = /^(\d+(?:\.\d+)?)(r?)$/.exec(h.get('ma') || '');
    if (ma) { f.makingAmount = ma[1]; f.makingUnit = ma[2] ? 'rs' : 'pct'; }
    const mk = /^(\d+(?:\.\d+)?)(pg|fx)?$/.exec(h.get('mk') || '');
    if (mk) { f.making = mk[1]; f.makingMode = mk[2] === 'pg' ? 'gram' : mk[2] === 'fx' ? 'flat' : 'pct'; }
    const d = /^(\d\d)(\d\d)(\d\d)$/.exec(h.get('d') || '');
    S = {
      live: S.live, f,
      custom: { k: rk, rate: +r[1], at: d ? new Date(2000 + +d[1], d[2] - 1, +d[3], 12).getTime() : undefined, shared: true },
      oldCustom: +digits(h.get('or')) || null,
      gstCustom: digits(h.get('ga')) != null ? +h.get('ga') : null,
      open: { more: ['wa', 'ds', 'sw', 'sv', 'hm', 'gst'].some((k) => h.has(k)), old: h.has('ow') },
    };
    viewingShared = true;
    $('shared').hidden = false;
  }
}
addEventListener('hashchange', () => { if (/(^|&)r=/.test(location.hash.slice(1))) location.reload(); });
if (S.f) apply(S.f);
for (const id of PANELS) if (S.open?.[id]) $(id).open = true;

let liveState = S.live ? 'stale' : 'loading';
const val = (name) => form.elements[name].value;
const liveBase = () => (S.live ? landed(S.live.inrOz, num($('duty')), num($('premium'))) : 0);

// Every karat's rate comes from one source rate: the one typed (for any karat), or today's live rate.
function source() {
  if (S.custom) return { k: S.custom.k, r: S.custom.rate };
  const k = val('rateK');
  return { k, r: S.live ? Math.round((liveBase() * PURITY[k]) / 999) : 0 };
}
const rateOf = (k, src) => (k === src.k ? src.r : Math.round((src.r * PURITY[k]) / PURITY[src.k]));

function setField(el, v, digits = f0) {
  if (document.activeElement !== el) el.value = v > 0 ? digits.format(v) : '';
}

function keys(box, vals, label) {
  box.innerHTML = vals.map((v) => `<button type="button" class="key" data-v="${v}">${label(v)}</button>`).join('');
}
for (const box of document.querySelectorAll('.presets[data-vals]')) {
  keys(box, box.dataset.vals.split(',').map(Number), short);
}

function line(op, label, sub, amount, cls = '') {
  return `<div class="${cls}"><span class="op" aria-hidden="true">${op}</span><dt>${label}${sub ? `<small>${sub}</small>` : ''}</dt><dd>${amount}</dd></div>`;
}

let last = null;
let makingMode = null;

function render() {
  const k = val('karat');
  const rk = val('rateK');
  const mode = val('mode');
  const src = source();
  const rate = rateOf(k, src);
  const oldK = val('oldKarat');
  const oldRate = S.oldCustom ?? rateOf(oldK, src);

  // Rate card
  setField($('rate'), rateOf(rk, src), S.custom?.k === rk ? f2 : f0);
  setField($('oldRate'), oldRate, S.oldCustom != null ? f2 : f0);
  $('oldUseLive').hidden = S.oldCustom == null;
  $('useLiveRow').hidden = !S.custom || !S.live;
  const status = $('status');
  const notes = [];
  const liveRk = S.live ? Math.round((liveBase() * PURITY[rk]) / 999) : 0;
  if (S.custom) {
    const dated = Number.isFinite(S.custom.at);
    const fresh = dated && today(S.custom.at);
    status.dataset.s = fresh && !S.custom.shared ? 'custom' : 'stale';
    status.textContent = S.custom.shared ? `Shared rate${dated ? `, ${day(S.custom.at)}` : ''}` : fresh ? 'Your rate' : dated ? `Your rate, ${day(S.custom.at)}` : 'Your saved rate';
    if (S.custom.k !== rk) notes.push(`Worked out from the ${S.custom.k}K rate of <b>${inr(S.custom.rate)}</b>.`);
    if (!fresh) notes.push(`${dated ? `This rate is from ${day(S.custom.at)}` : 'This rate was saved earlier'}. Gold rates change every day.`);
  } else {
    status.dataset.s = liveState;
    status.textContent =
      liveState === 'live' ? `Live, ${when(S.live.at)}` :
      liveState === 'loading' ? (S.live ? 'Updating…' : 'Loading…') :
      liveState === 'stale' ? `Saved, ${when(S.live.at)}` :
      'Offline';
    notes.push(
      liveState === 'error' ? 'Couldn’t get today’s rate. Check your internet and tap Refresh, or type your jeweller’s rate.' :
      liveState === 'stale' ? 'This is the last rate we got. Tap Refresh, or type your jeweller’s rate.' :
      'Type your jeweller’s rate to use it instead. Pick the karat it’s for first.'
    );
  }
  const cmp = S.custom && liveRk ? rateOf(rk, src) - liveRk : null;
  $('compare').hidden = cmp == null;
  $('compare').dataset.dir = cmp >= 1 ? 'up' : cmp <= -1 ? 'down' : '';
  if (cmp != null) {
    $('cLabel').textContent = liveState === 'live' ? `Today’s ${rk}K` : `Last live ${rk}K`;
    $('cLive').textContent = inr(liveRk);
    $('cMine').textContent = inr(rateOf(rk, src));
    $('cDiff').innerHTML = Math.abs(cmp) < 1 ? 'Same' : `${cmp > 0 ? '+' : '−'}₹${f0.format(Math.abs(cmp))}<small> ${pct((Math.abs(cmp) / liveRk) * 100)} ${cmp > 0 ? 'more' : 'less'}</small>`;
  }
  if (rk !== k && rate > 0) notes.push(`For ${k}K gold this works out to <b>${inr(rate)}</b> per g.`);
  $('rateNote').innerHTML = notes.map((n) => `<p>${n}</p>`).join('');
  $('refresh').setAttribute('aria-busy', String(liveState === 'loading'));
  // Rate board in the hero: today's live rates, whatever rate the calculator is using.
  for (const kk of ['24', '22', '18']) $(`rb${kk}`).textContent = S.live ? inr(Math.round((liveBase() * PURITY[kk]) / 999)) : '—';
  $('boardTime').textContent = !S.live ? (liveState === 'error' ? 'Offline' : 'Loading…') : liveState === 'loading' ? 'Updating…' : liveState === 'live' ? `Live, ${when(S.live.at)}` : `Saved, ${when(S.live.at)}`;
  if (S.live) {
    const g = S.live.inrOz / 31.1034768;
    $('eq').textContent = `World gold price is ${inr(S.live.inrOz)} an ounce, which is ${inr(g)} a gram. Add ${pct(num($('duty')))} import duty and ${inr(num($('premium')))} local premium: ${inr(liveBase())} a gram for 24K. Updated ${when(S.live.at)}.`;
  }

  // Mode
  const budgetMode = mode === 'budget';
  const checkMode = mode === 'check';
  document.documentElement.dataset.mode = mode;
  $('weightField').hidden = budgetMode;
  $('budgetField').hidden = !budgetMode;
  $('finalCard').hidden = !checkMode;
  $('makingCard').hidden = checkMode;
  $('discountField').hidden = checkMode;
  $('old').hidden = checkMode;

  // Making
  const mm = val('makingMode');
  $('makingPre').hidden = mm === 'pct';
  $('makingSuf').textContent = mm === 'pct' ? '%' : mm === 'gram' ? 'per g' : '';
  let makingHint = MAKING_KEYS[mm].hint;
  if (makingMode !== mm) {
    keys($('makingKeys'), MAKING_KEYS[mm].vals, MAKING_KEYS[mm].label);
    makingMode = mm;
  }
  for (const b of document.querySelectorAll('.presets[data-for] .key')) {
    b.setAttribute('aria-pressed', String(num($(b.parentElement.dataset.for)) === Number(b.dataset.v)));
  }

  const i = {
    gross: num($('gross')), stoneWt: num($('stoneWt')), rate,
    wastagePct: num($('wastagePct')), makingMode: mm, making: num($('making')), discountPct: checkMode ? 0 : num($('discountPct')),
    stoneValue: num($('stoneValue')), hallmark: num($('hallmark')), gstPct: num($('gstPct')),
    oldWeight: checkMode ? 0 : num($('oldWeight')), oldRate, oldDeductPct: num($('oldDeductPct')),
  };
  const budget = num($('budget'));
  const final = num($('final'));
  // The same bill at today's live rate, to show what an overridden rate changes.
  let atLive = null;
  if (cmp != null && Math.abs(cmp) >= 1 && !checkMode) {
    const ls = { k: rk, r: liveRk };
    const j = { ...i, rate: rateOf(k, ls), oldRate: S.oldCustom ?? rateOf(oldK, ls) };
    if (budgetMode) j.gross = maxNet(budget, j) + j.stoneWt;
    atLive = bill(j);
  }
  if (budgetMode) i.gross = maxNet(budget, i) + i.stoneWt;
  const b = bill(i);
  const maRaw = $('makingAmount').value.trim();
  const maPct = val('makingUnit') === 'pct';
  $('maPre').hidden = maPct;
  const stated = maRaw === '' ? {} : maPct ? { makingPct: num($('makingAmount')) } : { makingAmount: num($('makingAmount')) };
  const c = checkMode ? fromTotal(final, { ...i, gstAmount: S.gstCustom, ...stated }) : null;
  const gstEl = $('gstAmount');
  if (document.activeElement !== gstEl) gstEl.value = S.gstCustom != null ? f2.format(S.gstCustom) : c && final > 0 ? f0.format(c.gst) : '';

  if (mm !== 'pct' && b.gold > 0 && i.making > 0) makingHint += ` Here that is ${pct((b.makingFull / b.gold) * 100)} of the gold value.`;
  $('makingHint').textContent = makingHint;
  $('moreSum').textContent = [
    i.wastagePct && `Wastage ${pct(i.wastagePct)}`,
    i.discountPct && `Discount ${pct(i.discountPct)}`,
    i.stoneWt && `Stones ${f3.format(i.stoneWt)} g`,
    i.stoneValue && `Stone price ${inr(i.stoneValue)}`,
    i.hallmark && `Hallmark ${inr(i.hallmark)}`,
    `GST ${pct(i.gstPct)}`,
  ].filter(Boolean).map((x) => x.replace(/ /g, ' ')).join(', ');
  $('oldRateHint').textContent = S.oldCustom != null
    ? `The gold rate above gives ${inr(rateOf(oldK, src))} for ${oldK}K.`
    : `Filled from the gold rate above (${S.custom ? 'your rate' : 'today’s rate'}). Change it if the shop offers a different rate.`;
  $('oldSum').textContent = b.oldValue > 0 ? `${f3.format(i.oldWeight)} g of ${oldK}K, ${inr(-b.oldValue)}` : '';

  // Bill
  const why =
    rate <= 0 ? (checkMode ? 'Add the gold rate from the bill.' : 'Add a gold rate to see your bill.') :
    budgetMode && budget <= 0 ? 'Add your budget to see how much gold you can buy.' :
    budgetMode && b.net <= 0 ? 'This budget doesn’t cover the fixed charges. Try a bigger budget.' :
    !budgetMode && i.gross <= 0 ? (checkMode ? 'Add the gold weight from the bill.' : 'Add the weight to see your bill.') :
    !budgetMode && i.stoneWt >= i.gross ? 'Stone weight is more than the total weight. Check both.' :
    checkMode && final <= 0 ? 'Add the bill total to see what’s in it.' :
    checkMode && c.making + c.other < 0 ? 'The bill total is less than the gold value plus GST. Check the rate, weight and total.' : '';
  const ok = !why;
  $('empty').hidden = ok;
  $('empty').textContent = why;
  $('lines').hidden = !ok;
  $('facts').hidden = !ok;
  $('grand').hidden = !ok;
  $('display').hidden = !ok;
  document.body.classList.toggle('has-bar', ok);

  $('bill-title').textContent = checkMode ? 'The bill, broken down' : 'Your bill';
  $('billMeta').textContent = ok ? `${f3.format(b.net)} g of ${k}K` : `${k}K`;
  const goldLine = () => line('', 'Gold', `${f3.format(b.net)} g × ${inr(rate)}${i.stoneWt > 0 ? `, without ${f3.format(i.stoneWt)} g of stones` : ''}`, inr(b.gold));
  let html = '';
  let facts = '';
  if (ok && checkMode) {
    const mp = (c.making / c.gold) * 100;
    html += goldLine();
    if (c.wastage) html += line('+', 'Wastage', `${pct(i.wastagePct)} of gold`, inr(c.wastage));
    html += line('+', 'Making charges', `${pct(mp)} of gold, ${inr(c.making / c.net)} per gram${maRaw ? ', from the bill' : ', worked out'}`, inr(c.making));
    if (c.other) html += line(c.other > 0 ? '+' : '−', 'Not explained', 'Left over after gold, making and GST', inr(Math.abs(c.other)), c.other > 0 ? 'flag' : '');
    if (c.stones) html += line('+', 'Stones', '', inr(c.stones));
    if (c.hallmark) html += line('+', 'Hallmark fee', '', inr(c.hallmark));
    html += line('=', 'Price before GST', '', inr(c.taxable), 'sub');
    html += line('+', `GST ${pct(c.gstPct)}`, S.gstCustom != null ? 'from the bill' : `worked out at ${pct(i.gstPct)}`, inr(c.gst));
    const [, tone, says] = makingVerdict(mp);
    facts += `<li class="${tone}">Making charges of <span>${pct(mp)}</span> are ${says}.</li>`;
    if (c.other > 10) facts += `<li class="bad"><span>${inr(c.other)}</span> of the total isn’t explained by gold, making, stones, hallmark and GST. Ask the shop what it is for.</li>`;
    if (S.gstCustom === 0) facts += `<li class="bad">This bill has no GST. Jewellery carries 3% GST; ask for a proper GST bill.</li>`;
    else if (S.gstCustom != null && Math.abs(c.gstPct - 3) > 0.05) facts += `<li class="bad">GST on this bill is <span>${pct(c.gstPct)}</span> of the price. GST on jewellery is 3%.</li>`;
    facts += `<li>All in, you pay <span>${inr(c.total / c.net)}</span> per gram of gold, ${pct((c.total / c.gold - 1) * 100)} over the gold value.</li>`;
    if (S.custom && liveRk && liveState !== 'error') {
      const d = rate - rateOf(k, { k: rk, r: liveRk });
      const cost = Math.round(Math.abs(d) * c.net * (1 + i.gstPct / 100));
      if (Math.abs(d) >= 1) facts += `<li class="${d > 0 ? 'bad' : 'good'}">The shop’s ${k}K rate is <span>${inr(Math.abs(d))}</span> per gram ${d > 0 ? 'above' : 'below'} today’s rate. On this piece that is <span>${inr(cost)}</span> ${d > 0 ? 'more' : 'less'}, GST included.</li>`;
    }
  } else if (ok) {
    html += goldLine();
    if (b.wastage) html += line('+', 'Wastage', `${pct(i.wastagePct)} of gold`, inr(b.wastage));
    const asPct = b.gold ? `${pct((b.makingFull / b.gold) * 100)} of gold` : '';
    const mSub = mm === 'pct' ? asPct : mm === 'gram' ? `${inr(i.making)} per gram, ${asPct}` : `Fixed, ${asPct}`;
    html += line('+', 'Making charges', mSub, inr(b.makingFull));
    if (b.discount) html += line('−', 'Discount on making', pct(i.discountPct), inr(b.discount));
    if (i.stoneValue) html += line('+', 'Stones', '', inr(i.stoneValue));
    if (i.hallmark) html += line('+', 'Hallmark fee', '', inr(i.hallmark));
    html += line('=', 'Price before GST', '', inr(b.taxable), 'sub');
    html += line('+', `GST ${pct(i.gstPct)}`, '', inr(b.gst));
    if (b.oldValue > 0) {
      html += line('=', 'Jewellery price', '', inr(b.total), 'sub');
      html += line('−', 'Old gold', `${f3.format(i.oldWeight)} g of ${oldK}K × ${inr(oldRate)}${i.oldDeductPct ? `, less ${pct(i.oldDeductPct)}` : ''}`, inr(b.oldValue));
    }
    facts = `<li>Cost per gram with all charges: <span>${inr(b.total / b.net)}</span></li>` +
      `<li>Charges on top of the gold: <span>${pct(((b.making + b.wastage) / b.gold) * 100 || 0)}</span></li>` +
      (atLive ? (budgetMode
        ? `<li>At today’s rate you could buy: <span>${f3.format(atLive.net)} g</span></li>`
        : `<li>At today’s rate this bill would be: <span>${inr(atLive.payable)}</span> (${inr(Math.abs(b.payable - atLive.payable))} ${b.payable > atLive.payable ? 'less' : 'more'})</li>`)
        : '');
  }
  $('lines').innerHTML = html;
  $('facts').innerHTML = facts;

  const payable = checkMode ? c.total : b.payable;
  const refund = ok && payable < -0.5;
  const payLabel = checkMode ? 'Bill total' : refund ? 'Shop pays you' : 'Total to pay';
  $('gLabel').textContent = payLabel;
  $('gTotal').textContent = inr(ok ? Math.abs(payable) : 0);

  $('tLabel').textContent = budgetMode ? 'You can buy' : checkMode ? 'Making charges in this bill' : payLabel;
  $('total').textContent = !ok ? '' : budgetMode ? `${f3.format(b.net)} g` : checkMode ? `${pct((c.making / c.gold) * 100)}` : inr(Math.abs(b.payable));
  $('words').textContent = !ok ? '' : budgetMode
    ? `of ${k}K gold for ${inr(b.payable)}`
    : checkMode
      ? `of the gold value: ${inr(c.making)} in all, ${inr(c.making / c.net)} per gram`
      : [`${f3.format(b.net)} g of ${k}K`, lakh(Math.abs(b.payable)) && `${lakh(Math.abs(b.payable))} rupees`].filter(Boolean).join(', ');

  $('pan').hidden = !(ok && (checkMode ? c.total : b.total) >= 200000);
  $('share').disabled = !ok;

  last = ok ? { b, k, src, payable, net: checkMode ? c.net : b.net } : null;
  scrollers.forEach(fade);
}

// Editing a shared bill makes it the visitor's own saved bill.
function claim() {
  if (!viewingShared) return;
  viewingShared = false;
  if (S.custom) S.custom.shared = false;
  $('shared').hidden = true;
  history.replaceState(null, '', location.pathname + location.search);
}

function persist() {
  claim();
  S.f = gather();
  save();
}

// Inputs
form.addEventListener('input', (e) => {
  const el = e.target;
  if (el.inputMode === 'decimal' || el.inputMode === 'numeric') {
    const clean = el.value.replace(el.inputMode === 'numeric' ? /[^\d,]/g : /[^\d.,]/g, '');
    if (clean !== el.value) el.value = clean;
  }
  if (el.id === 'rate') S.custom = el.value.trim() ? { k: val('rateK'), rate: num(el), at: Date.now() } : null;
  if (el.id === 'oldRate') S.oldCustom = el.value.trim() ? num(el) : null;
  if (el.id === 'gstAmount') S.gstCustom = el.value.trim() ? num(el) : null;
  persist();
  render();
});
form.addEventListener('change', () => { persist(); render(); });

form.addEventListener('click', (e) => {
  const b = e.target.closest('.presets[data-for] .key');
  if (!b) return;
  const el = $(b.parentElement.dataset.for);
  el.value = el.dataset.fmt !== undefined ? f2.format(Number(b.dataset.v)) : b.dataset.v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
});


form.addEventListener('focusin', (e) => {
  const el = e.target;
  if (el.tagName !== 'INPUT' || !el.inputMode) return;
  el.value = el.value.replace(/,/g, '');
  requestAnimationFrame(() => el.select());
});
form.addEventListener('focusout', (e) => {
  const el = e.target;
  if ((el.dataset.fmt !== undefined || el.id === 'rate') && el.value) el.value = f2.format(num(el));
  render();
});
form.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || !e.target.inputMode) return;
  e.preventDefault();
  const list = [...form.querySelectorAll('input[inputmode]')].filter((x) => x.offsetParent);
  const next = list[list.indexOf(e.target) + 1];
  next ? next.focus() : e.target.blur();
});

$('useLive').onclick = () => { claim(); S.custom = null; save(); render(); };
$('oldUseLive').onclick = () => { claim(); S.oldCustom = null; save(); render(); };
$('mine').onclick = () => { history.replaceState(null, '', location.pathname + location.search); location.reload(); };

// Clear all asks first, then resets everything except the remembered choices.
const confirmBox = $('confirm');
$('reset').onclick = () => { confirmBox.returnValue = ''; confirmBox.showModal(); };
confirmBox.addEventListener('close', () => {
  if (confirmBox.returnValue !== 'clear') return;
  claim();
  apply({ ...DEFAULTS, ...pick(gather()) });
  S = { f: pick(gather()), live: S.live };
  save();
  render();
});

// Live price: gold-api.com, falling back to the daily currency-api.
async function getSpot() {
  try {
    const r = await fetch('https://api.gold-api.com/price/XAU/INR', { cache: 'no-store' });
    const j = await r.json();
    if (j.price > 0) return { inrOz: j.price, at: Date.parse(j.updatedAt) || Date.now() };
  } catch {}
  const r = await fetch('https://latest.currency-api.pages.dev/v1/currencies/xau.json');
  const j = await r.json();
  if (!(j.xau?.inr > 0)) throw new Error('No price');
  return { inrOz: j.xau.inr, at: Date.parse(j.date) };
}

async function refresh() {
  liveState = 'loading';
  render();
  try {
    S.live = { ...(await getSpot()), fetched: Date.now() };
    liveState = 'live';
    save();
  } catch {
    liveState = S.live ? 'stale' : 'error';
  }
  render();
}
$('refresh').onclick = refresh;
// Coming back to the tab after a while fetches a fresh rate.
// The live rate is cached for 10 minutes; the refresh button always fetches.
const FRESH = 10 * 60 * 1000;
const stale = () => Date.now() - (S.live?.fetched || 0) > FRESH;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && stale()) refresh();
});

// Share: a link that rebuilds this exact bill, rate included.
function shareLink() {
  const f = gather();
  const p = [];
  const budgetMode = f.mode === 'budget';
  for (const [name, key] of Object.entries(SHORT)) {
    const v = f[name].replace(/,/g, '');
    const checkOnly = name === 'final';
    if (!digits(v) || v === DEFAULTS[name] || (name === 'gross' && budgetMode) || (name === 'budget' && !budgetMode) || (checkOnly && f.mode !== 'check')) continue;
    p.push(`${key}=${v}`);
  }
  const mk = f.making.replace(/,/g, '');
  if (digits(mk) && (mk !== DEFAULTS.making || f.makingMode !== 'pct')) p.push(`mk=${mk}${MODE_SUFFIX[f.makingMode]}`);
  p.push(`r=${last.src.r}${last.src.k === '22' ? '' : `-${last.src.k}`}`);
  if (S.oldCustom != null) p.push(`or=${S.oldCustom}`);
  if (f.mode === 'check') {
    if (S.gstCustom != null) p.push(`ga=${S.gstCustom}`);
    const ma = f.makingAmount.replace(/,/g, '');
    if (digits(ma)) p.push(`ma=${ma}${f.makingUnit === 'rs' ? 'r' : ''}`);
  }
  const d = new Date(S.custom?.at || S.live?.at || Date.now());
  p.push(`d=${String(d.getFullYear() % 100).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`);
  return `${location.origin}${location.pathname}#${p.join('&')}`;
}

$('share').onclick = async () => {
  if (!last) return;
  const { k, payable, net } = last;
  const url = shareLink();
  const text = `Gold bill: ${f3.format(net)} g of ${k}K, ${payable < -0.5 ? 'shop pays' : 'total'} ${inr(Math.abs(payable))}`;
  const btn = $('share');
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) return await navigator.share({ title: 'Gold bill', text, url });
    await navigator.clipboard.writeText(url);
    btn.textContent = 'Link copied';
  } catch (err) {
    if (err?.name === 'AbortError') return;
    try { await navigator.clipboard.writeText(url); btn.textContent = 'Link copied'; } catch { btn.textContent = 'Couldn’t share. Try again'; }
  }
  setTimeout(() => (btn.textContent = 'Share bill'), 1800);
};

// Hero buttons switch mode and jump to the rate, where both flows start.
for (const b of document.querySelectorAll('[data-goto]')) {
  b.addEventListener('click', () => {
    form.querySelector(`input[name=mode][value=${b.dataset.goto}]`).click();
    document.querySelector('.mode-wrap').scrollIntoView({ block: 'start' });
    if (b.dataset.goto === 'check') $('rate').focus({ preventScroll: true });
  });
}

// Help links open their topic.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#h-"], a[href="#help"]');
  const t = a && document.querySelector(a.getAttribute('href'));
  if (t?.tagName === 'DETAILS') t.open = true;
});

// Theme
const root = document.documentElement;
const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
const themeLabel = () => $('theme').setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
themeLabel();
$('theme').onclick = () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  themeLabel();
  try { localStorage.setItem('theme', root.dataset.theme); } catch {}
};

// Desktop result column: stick at the top, or at the bottom once it's taller than the window.
const out = document.querySelector('.out');
const pin = () => out.style.setProperty('--out-top', `${Math.min(24, innerHeight - out.offsetHeight - 24)}px`);
new ResizeObserver(pin).observe(out);
addEventListener('resize', pin);

// On touch screens the result bar steps aside while a field has focus, so it stays behind the keyboard.
document.addEventListener('focusin', (e) => { if (matchMedia('(pointer: coarse)').matches && e.target.matches('input[inputmode]')) document.body.classList.add('typing'); });
document.addEventListener('focusout', () => document.body.classList.remove('typing'));

// Preset rows fade at whichever edge has more to scroll.
const scrollers = [...document.querySelectorAll('.presets, .rate-for')];
const fade = (el) => {
  el.style.setProperty('--fl', el.scrollLeft > 1 ? '28px' : '0px');
  el.style.setProperty('--fr', el.scrollLeft + el.clientWidth < el.scrollWidth - 1 ? '28px' : '0px');
};
for (const el of scrollers) el.addEventListener('scroll', () => fade(el), { passive: true });
new ResizeObserver(() => scrollers.forEach(fade)).observe(form);

if (!stale()) liveState = 'live';
render();
if (stale()) refresh();
