import { PURITY, bill, fromTotal, landed, maxNet } from './calc.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
const KEY = 'gold-calc:v1';
const f0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const f2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const f3 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const inr = (v) => (v < -0.5 ? '−' : '') + '₹' + f0.format(Math.abs(Math.round(v)));
const pct = (v) => f2.format(v) + '%';
const f1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const pct1 = (v) => f1.format(v) + '%';
const sentence = (t) => t.charAt(0).toUpperCase() + t.slice(1) + '.';
const lakh = (v) => (v >= 1e7 ? `${f2.format(v / 1e7)} crore` : v >= 1e5 ? `${f2.format(v / 1e5)} lakh` : '');
const short = (v) => (v >= 1e5 ? `₹${lakh(v)}` : inr(v));
const num = (el) => parseFloat(String(el.value).replace(/,/g, '')) || 0;
const today = (t) => new Date(t).toDateString() === new Date().toDateString();
const day = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const when = (t) =>
  (today(t) ? '' : `${day(t)}, `) + new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

const MAKING_KEYS = {
  pct: {
    vals: [5, 6, 8, 10, 12, 15, 18, 20],
    label: (v) => `${v}%`,
    hint: 'Plain 22K jewellery at local shops is usually 6% to 12%; branded stores often charge 12% to 20%. Ask if wastage is extra.',
  },
  gram: {
    vals: [300, 500, 700, 900, 1200],
    label: inr,
    hint: 'A fixed amount for every gram of gold. Machine-made chains often cost ₹300 to ₹900 a gram.',
  },
  flat: { vals: [500, 1000, 2000, 5000], label: inr, hint: 'One fixed amount for the whole piece.' },
};
const PANELS = ['more', 'old', 'src'];

// Market norms: 24K coins 0.5-3%, plain 22K 5-15%, 18K and lower (mostly studded) 15-24%.
const MAKING_BANDS = {
  coin: [
    [2, 'good', 'low for a 24K coin or bar'],
    [3, '', 'within the usual 0.5% to 3% for a 24K coin or bar'],
    [
      8,
      'bad',
      'high for a 24K coin or bar, which usually costs 0.5% to 3% to make. Compare with a bank or another jeweller',
    ],
    [
      Infinity,
      'bad',
      'very high for 24K gold. Coins and bars usually cost 0.5% to 3% to make; ask what this charge covers',
    ],
  ],
  plain: [
    [6, 'good', 'a very good deal for {k} jewellery; plain machine-made pieces go for about this much'],
    [12, '', 'a fair price for plain {k} jewellery at a local shop'],
    [20, 'bad', 'on the high side for {k}, like branded stores. Ask for a lower making charge'],
    [
      Infinity,
      'bad',
      'high for {k}; only intricate, handmade or bridal pieces usually cost this much. Ask for a lower rate',
    ],
  ],
  studded: [
    [10, 'good', 'low for {k} jewellery, which usually costs more to make than 22K'],
    [16, '', 'a fair price for {k} jewellery'],
    [24, '', 'usual for diamond or studded {k} work, but high for a plain piece. If it has no stones, ask for less'],
    [
      Infinity,
      'bad',
      'high even for diamond or studded {k} work, which usually costs 15% to 24% to make. Ask for a lower rate',
    ],
  ],
};
const bandFor = (k) => (k === '24' ? 'coin' : k === '22' || k === '20' ? 'plain' : 'studded');
const makingVerdict = (p, k) => {
  const [, tone, text] = MAKING_BANDS[bandFor(k)].find(([max]) => p <= max);
  return [tone, text.replaceAll('{k}', `${k}K`)];
};
// Shop rates in one city vary by about 1%: smaller gaps, or under ₹500 on the piece, are noise.
const RATE_NOISE_PCT = 1,
  RATE_FLAG_PCT = 3,
  RATE_NOISE_RS = 500;
const BUYBACK_CUT = 0.03;
function rateGap(diff, live, impact) {
  const gap = live > 0 ? (diff / live) * 100 : 0;
  if (Math.abs(gap) < RATE_NOISE_PCT || Math.abs(impact) < RATE_NOISE_RS) return { level: 'same', gap };
  if (gap < 0) return { level: 'below', gap };
  return { level: gap >= RATE_FLAG_PCT ? 'high' : 'above', gap };
}

const MAKING_PCT_HINT = {
  coin: '24K coins and bars usually cost 0.5% to 3% to make.',
  plain:
    'Plain {k} jewellery at local shops is usually 6% to 12%; branded stores often charge 12% to 20%. Ask if wastage is extra.',
  studded:
    '{k} jewellery is often diamond or studded and usually costs 15% to 24% to make; plain {k} pieces should cost less.',
};

const fields = [...form.querySelectorAll('[data-k]')];
const gather = () => {
  const o = {};
  for (const el of fields) if (el.type !== 'radio' || el.checked) o[el.name || el.id] = el.value;
  return o;
};
// Defaults from the markup itself; the pre-paint script may already have changed what's checked.
const DEFAULTS = {};
for (const el of fields)
  if (el.type !== 'radio' || el.defaultChecked)
    DEFAULTS[el.name || el.id] = el.type === 'radio' ? el.value : el.defaultValue;
const apply = (o) => {
  for (const el of fields) {
    const v = o[el.name || el.id];
    if (v == null) continue;
    if (el.type === 'radio') el.checked = el.value === v;
    else el.value = v;
  }
  // An unknown value leaves a radio group empty: fall back to its default.
  for (const el of fields)
    if (el.type === 'radio' && !form.elements[el.name].value && el.value === DEFAULTS[el.name]) el.checked = true;
};

const KEEP = ['karat', 'rateK', 'mode', 'rateUnit'];
const pick = (f = {}) => Object.fromEntries(KEEP.filter((k) => f[k] != null).map((k) => [k, f[k]]));
let S = {};
try {
  const o = JSON.parse(localStorage.getItem(KEY)) || {};
  S = { f: pick(o.f), live: o.live };
} catch {}
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ f: pick(S.f), live: S.live }));
  } catch {}
};

// URL state: short keys, digits only, defaults left out, e.g. ?k=18&w=10&f=125000&r=10700-18&d=261111.
const SHORT = {
  karat: 'k',
  rateK: 'rk',
  rateUnit: 'ru',
  gross: 'w',
  budget: 'b',
  wastagePct: 'wa',
  discountPct: 'ds',
  stoneWt: 'sw',
  stoneValue: 'sv',
  hallmark: 'hm',
  gstPct: 'gst',
  oldKarat: 'ok',
  oldWeight: 'ow',
  oldDeductPct: 'ol',
  final: 'f',
};
const MODE_SUFFIX = { pct: '', gram: 'pg', flat: 'fx' };
const digits = (v) => (/^\d+(\.\d+)?$/.test(v || '') ? v : null);
const yymmdd = (t) => {
  const d = new Date(t);
  return `${String(d.getFullYear() % 100).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

{
  // Older links carried the state in the hash; read those too and move them to the query.
  const legacy = !location.search && location.hash.includes('=');
  const q = new URLSearchParams(legacy ? location.hash.slice(1) : location.search);
  if ([...q.keys()].length) {
    const f = { ...DEFAULTS };
    for (const [name, key] of Object.entries(SHORT)) if (digits(q.get(key))) f[name] = q.get(key);
    const m = q.get('m');
    f.mode = /^(check|price|budget)$/.test(m)
      ? m
      : q.has('b')
        ? 'budget'
        : q.has('f')
          ? 'check'
          : legacy
            ? 'price'
            : DEFAULTS.mode;
    f.gstUnit = q.has('ga') || q.get('gu') === 'rs' ? 'rs' : 'pct';
    const ma = /^(\d+(?:\.\d+)?)(r?)$/.exec(q.get('ma') || '');
    f.makingUnit = ma?.[2] || q.get('mu') === 'rs' ? 'rs' : 'pct';
    const mk = /^(\d+(?:\.\d+)?)(pg|fx)?$/.exec(q.get('mk') || '');
    if (mk) {
      f.making = mk[1];
      f.makingMode = mk[2] === 'pg' ? 'gram' : mk[2] === 'fx' ? 'flat' : 'pct';
    }
    const r = /^(\d+(?:\.\d+)?)(?:-(\d+))?$/.exec(q.get('r') || '');
    const rk = r?.[2] || '22';
    const d = /^(\d\d)(\d\d)(\d\d)$/.exec(q.get('d') || '');
    S = {
      live: S.live,
      f,
      custom:
        r && PURITY[rk] && +r[1] > 0
          ? { k: rk, rate: +r[1], at: d ? new Date(2000 + +d[1], d[2] - 1, +d[3], 12).getTime() : undefined }
          : null,
      oldCustom: +digits(q.get('or')) || null,
      makingCustom: ma ? +ma[1] : null,
      gstCustom: digits(q.get('gp')) != null ? +q.get('gp') : digits(q.get('ga')) != null ? +q.get('ga') : null,
      open: { more: ['wa', 'ds', 'sw', 'sv', 'hm', 'gst'].some((k) => q.has(k)), old: q.has('ow') },
    };
  }
}
if (S.f) apply(S.f);
for (const id of PANELS) if (S.open?.[id]) $(id).open = true;
for (const el of form.querySelectorAll('input[data-fmt]')) if (el.value) el.value = f2.format(num(el));

let liveState = S.live ? 'stale' : 'loading';
const val = (name) => form.elements[name].value;
const liveBase = () => (S.live ? landed(S.live.inrOz, num($('duty')), num($('premium'))) : 0);

// All karat rates derive from one source: the typed rate (any karat) or today's live rate.
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
let lastCheck = null;
let barClosed = false,
  wasOk = false,
  lastMode = null;
let makingMode = null;

function render() {
  const k = val('karat');
  const rk = val('rateK');
  const mode = val('mode');
  const src = source();
  const rate = rateOf(k, src);
  const oldK = val('oldKarat');
  const oldRate = S.oldCustom ?? rateOf(oldK, src);

  const per = Number(val('rateUnit')) || 1;
  setField($('rate'), rateOf(rk, src) * per, S.custom?.k === rk ? f2 : f0);
  setField($('oldRate'), oldRate, S.oldCustom != null ? f2 : f0);
  $('oldUseLive').hidden = S.oldCustom == null;
  $('useLiveRow').hidden = !S.custom || !S.live;
  const status = $('status');
  const notes = [];
  const liveRk = S.live ? Math.round((liveBase() * PURITY[rk]) / 999) : 0;
  if (S.custom) {
    const dated = Number.isFinite(S.custom.at);
    const fresh = dated && today(S.custom.at);
    status.dataset.s = fresh ? 'custom' : 'stale';
    status.textContent = fresh ? 'Your rate' : dated ? `Your rate, ${day(S.custom.at)}` : 'Your saved rate';
    if (S.custom.k !== rk) notes.push(`Worked out from the ${S.custom.k}K rate of <b>${inr(S.custom.rate)}</b>.`);
    if (!fresh)
      notes.push(
        `${dated ? `This rate is from ${day(S.custom.at)}` : 'This rate was saved earlier'}. Gold rates change every day.`,
      );
  } else {
    status.dataset.s = liveState;
    status.textContent =
      liveState === 'live'
        ? `Live, ${when(S.live.at)}`
        : liveState === 'loading'
          ? S.live
            ? 'Updating…'
            : 'Loading…'
          : liveState === 'stale'
            ? `Saved, ${when(S.live.at)}`
            : 'Offline';
    notes.push(
      liveState === 'error'
        ? 'Couldn’t get today’s rate. Check your internet and tap Refresh, or type your jeweller’s rate.'
        : liveState === 'stale'
          ? 'This is the last rate we got. Tap Refresh, or type your jeweller’s rate.'
          : 'Type your jeweller’s rate to use it instead. Pick the karat it’s for first.',
    );
  }
  const cmp = S.custom && liveRk ? rateOf(rk, src) - liveRk : null;
  $('compare').hidden = cmp == null;
  const cmpPct = cmp != null && liveRk ? (cmp / liveRk) * 100 : 0;
  $('compare').dataset.dir = cmpPct >= RATE_NOISE_PCT ? 'up' : cmpPct <= -RATE_NOISE_PCT ? 'down' : '';
  if (cmp != null) {
    $('cLabel').textContent = liveState === 'live' ? `Today’s ${rk}K` : `Last live ${rk}K`;
    $('cLive').textContent = inr(liveRk * per);
    $('cDiff').textContent =
      Math.abs(cmp) < 1 ? 'Same as yours' : `Yours is ${inr(Math.abs(cmp) * per)} ${cmp > 0 ? 'more' : 'less'}`;
  }
  if (rk !== k && rate > 0) notes.push(`For ${k}K gold this works out to <b>${inr(rate)}</b> per g.`);
  $('rateNote').innerHTML = notes.map((n) => `<p>${n}</p>`).join('');
  $('refresh').setAttribute('aria-busy', String(liveState === 'loading'));
  // The board always shows live rates, even when a typed rate is in use.
  for (const kk of ['24', '22', '18'])
    $(`rb${kk}`).textContent = S.live ? inr(Math.round((liveBase() * PURITY[kk]) / 999)) : '—';
  $('boardTime').textContent = !S.live
    ? liveState === 'error'
      ? 'Offline'
      : 'Loading…'
    : liveState === 'loading'
      ? 'Updating…'
      : liveState === 'live'
        ? `Live, ${when(S.live.at)}`
        : `Saved, ${when(S.live.at)}`;
  if (S.live) {
    const g = S.live.inrOz / 31.1034768;
    $('eq').textContent =
      `World gold price is ${inr(S.live.inrOz)} an ounce, which is ${inr(g)} a gram. Add ${pct(num($('duty')))} import duty and ${inr(num($('premium')))} local premium: ${inr(liveBase())} a gram for 24K. Updated ${when(S.live.at)}.`;
  }

  const budgetMode = mode === 'budget';
  const checkMode = mode === 'check';
  document.documentElement.dataset.mode = mode;
  $('weightField').hidden = budgetMode;
  $('budgetField').hidden = !budgetMode;
  $('finalCard').hidden = !checkMode;
  $('makingCard').hidden = checkMode;
  $('discountField').hidden = checkMode;
  $('old').hidden = checkMode;

  const mm = val('makingMode');
  $('makingPre').hidden = mm === 'pct';
  $('makingSuf').textContent = mm === 'pct' ? '%' : mm === 'gram' ? 'per g' : '';
  let makingHint = mm === 'pct' ? MAKING_PCT_HINT[bandFor(k)].replaceAll('{k}', `${k}K`) : MAKING_KEYS[mm].hint;
  if (makingMode !== mm) {
    keys($('makingKeys'), MAKING_KEYS[mm].vals, MAKING_KEYS[mm].label);
    makingMode = mm;
  }
  for (const b of document.querySelectorAll('.presets[data-for] .key')) {
    b.setAttribute('aria-pressed', String(num($(b.parentElement.dataset.for)) === Number(b.dataset.v)));
  }

  const i = {
    gross: num($('gross')),
    stoneWt: num($('stoneWt')),
    rate,
    wastagePct: num($('wastagePct')),
    makingMode: mm,
    making: num($('making')),
    discountPct: checkMode ? 0 : num($('discountPct')),
    stoneValue: num($('stoneValue')),
    hallmark: num($('hallmark')),
    gstPct: num($('gstPct')),
    oldWeight: checkMode ? 0 : num($('oldWeight')),
    oldRate,
    oldDeductPct: num($('oldDeductPct')),
  };
  const budget = num($('budget'));
  const final = num($('final'));
  let atLive = null;
  if (cmp != null && Math.abs(cmp) >= 1 && !checkMode) {
    const ls = { k: rk, r: liveRk };
    const j = { ...i, rate: rateOf(k, ls), oldRate: S.oldCustom ?? rateOf(oldK, ls) };
    if (budgetMode) j.gross = maxNet(budget, j) + j.stoneWt;
    atLive = bill(j);
  }
  if (budgetMode) i.gross = maxNet(budget, i) + i.stoneWt;
  const b = bill(i);
  // Left empty, the field shows the derived making.
  const maInPct = val('makingUnit') === 'pct';
  $('maPre').hidden = maInPct;
  const stated =
    S.makingCustom == null ? {} : maInPct ? { makingPct: S.makingCustom } : { makingAmount: S.makingCustom };
  // Left empty, the field shows the default GST.
  const gstInPct = val('gstUnit') === 'pct';
  $('gaPre').hidden = gstInPct;
  const gstOpt = S.gstCustom == null ? {} : gstInPct ? { gstPct: S.gstCustom } : { gstAmount: S.gstCustom };
  const c = checkMode ? fromTotal(final, { ...i, ...gstOpt, ...stated }) : null;
  lastCheck = c;
  const gstEl = $('gstAmount');
  if (document.activeElement !== gstEl) {
    gstEl.value =
      S.gstCustom != null
        ? f2.format(S.gstCustom)
        : gstInPct
          ? f2.format(i.gstPct)
          : c && final > 0
            ? f0.format(c.gst)
            : '';
  }
  const maEl = $('makingAmount');
  if (document.activeElement !== maEl) {
    const derived = c && final > 0 && c.gold > 0 && c.making >= 0;
    maEl.value =
      S.makingCustom != null
        ? f2.format(S.makingCustom)
        : !derived
          ? ''
          : maInPct
            ? f2.format((c.making / c.gold) * 100)
            : f0.format(c.making);
  }

  if (mm !== 'pct' && b.gold > 0 && i.making > 0)
    makingHint += ` Here that is ${pct((b.makingFull / b.gold) * 100)} of the gold value.`;
  $('makingHint').textContent = makingHint;
  $('moreSum').textContent = [
    i.wastagePct && `Wastage ${pct(i.wastagePct)}`,
    i.discountPct && `Discount ${pct(i.discountPct)}`,
    i.stoneWt && `Stones ${f3.format(i.stoneWt)} g`,
    i.stoneValue && `Stone price ${inr(i.stoneValue)}`,
    i.hallmark && `Hallmark ${inr(i.hallmark)}`,
    !checkMode && `GST ${pct(i.gstPct)}`,
  ]
    .filter(Boolean)
    .map((x) => x.replace(/ /g, ' '))
    .join(', ');
  $('oldRateHint').textContent =
    S.oldCustom != null
      ? `The gold rate above gives ${inr(rateOf(oldK, src))} for ${oldK}K.`
      : `Filled from the gold rate above (${S.custom ? 'your rate' : 'today’s rate'}). Change it if the shop offers a different rate.`;
  $('oldSum').textContent = b.oldValue > 0 ? `${f3.format(i.oldWeight)} g of ${oldK}K, ${inr(-b.oldValue)}` : '';

  const why =
    rate <= 0
      ? checkMode
        ? 'Add the gold rate from the bill.'
        : 'Add a gold rate to see your bill.'
      : budgetMode && budget <= 0
        ? 'Add your budget to see how much gold you can buy.'
        : budgetMode && b.net <= 0
          ? 'This budget doesn’t cover the fixed charges. Try a bigger budget.'
          : !budgetMode && i.gross <= 0
            ? checkMode
              ? 'Add the gold weight from the bill.'
              : 'Add the weight to see your bill.'
            : !budgetMode && i.stoneWt >= i.gross
              ? 'Stone weight is more than the total weight. Check both.'
              : checkMode && final <= 0
                ? 'Add the bill total to see what’s in it.'
                : checkMode && c.making + c.other < 0
                  ? 'The bill total is less than the gold value plus GST. Check the rate, weight and total.'
                  : '';
  const ok = !why;
  $('empty').hidden = ok;
  $('empty').textContent = why;
  $('lines').hidden = !ok;
  $('facts').hidden = !ok;
  $('grand').hidden = !ok;
  $('display').hidden = !ok;
  // A closed bar comes back for a new bill: after the result was empty, or in another mode.
  if ((ok && !wasOk) || mode !== lastMode) barClosed = false;
  wasOk = ok;
  lastMode = mode;
  syncBar();

  $('bill-title').textContent = checkMode ? 'What’s in this bill' : 'Your bill';
  $('billMeta').textContent = ok ? `${f3.format(b.net)} g of ${k}K` : `${k}K`;
  const goldLine = () =>
    line(
      '',
      'Gold',
      `${f3.format(b.net)} g × ${inr(rate)}${i.stoneWt > 0 ? `, without ${f3.format(i.stoneWt)} g of stones` : ''}`,
      inr(b.gold),
    );
  let html = '';
  const facts = [];
  if (ok && checkMode) {
    const mp = (c.making / c.gold) * 100;
    html += goldLine();
    if (c.wastage) html += line('+', 'Wastage', `${pct(i.wastagePct)} of gold`, inr(c.wastage));
    html += line(
      '+',
      'Making charges',
      `${pct(mp)} of gold${S.makingCustom != null ? ', from the bill' : ''}`,
      inr(c.making),
    );
    if (c.other)
      html += line(
        c.other > 0 ? '+' : '−',
        'Not explained',
        'Left over after gold, making and GST',
        inr(Math.abs(c.other)),
        c.other > 0 ? 'flag' : '',
      );
    if (c.stones) html += line('+', 'Stones', '', inr(c.stones));
    if (c.hallmark) html += line('+', 'Hallmark fee', '', inr(c.hallmark));
    html += line('=', 'Price before GST', '', inr(c.taxable), 'sub');
    html += line('+', `GST ${pct(c.gstPct)}`, S.gstCustom != null ? 'from the bill' : '', inr(c.gst));
    const [tone, says] = makingVerdict(mp, k);
    facts.push({ tone, label: 'Making charges', value: pct1(mp), note: sentence(says) });
    if (c.other > 10)
      facts.push({
        tone: 'bad',
        label: 'Not explained',
        value: inr(c.other),
        note: 'Not covered by gold, making, stones, hallmark or GST. Ask the shop what it is for.',
      });
    if (c.other < -10)
      facts.push({
        tone: 'bad',
        label: 'Doesn’t add up',
        value: inr(c.other),
        note: 'The making charge entered is more than the total allows. Check it against the bill.',
      });
    if (S.gstCustom === 0)
      facts.push({
        tone: 'bad',
        label: 'GST',
        value: 'None',
        note: 'Jewellery carries 3% GST. Ask for a proper GST bill.',
      });
    else if (S.gstCustom != null && Math.abs(c.gstPct - 3) > 0.05)
      facts.push({ tone: 'bad', label: 'GST', value: pct1(c.gstPct), note: 'GST on jewellery is 3%.' });
    if (S.custom && liveRk && liveState !== 'error') {
      const liveK = rateOf(k, { k: rk, r: liveRk });
      const cost = Math.round((rate - liveK) * c.net * (1 + i.gstPct / 100));
      const g = rateGap(rate - liveK, liveK, cost);
      const onPiece = `${inr(Math.abs(cost))} ${cost > 0 ? 'more' : 'less'} on this piece, GST included.`;
      facts.push(
        g.level === 'same'
          ? { tone: '', label: `Shop’s ${k}K rate`, value: 'In line', note: 'Close to today’s rate.' }
          : g.level === 'below'
            ? {
                tone: 'good',
                label: `Shop’s ${k}K rate`,
                value: `${pct1(Math.abs(g.gap))} below`,
                note: `Below today’s rate: ${onPiece}`,
              }
            : g.level === 'above'
              ? {
                  tone: '',
                  label: `Shop’s ${k}K rate`,
                  value: `${pct1(g.gap)} above`,
                  note: `A little above today’s rate: ${onPiece}`,
                }
              : {
                  tone: 'bad',
                  label: `Shop’s ${k}K rate`,
                  value: `${pct1(g.gap)} above`,
                  note: `Well above today’s rate: ${onPiece} Ask which rate the shop is using.`,
                },
      );
    }
    facts.push({
      tone: '',
      label: 'All-in price',
      value: `${inr(c.total / c.net)}/g`,
      note: `${pct1((c.total / c.gold - 1) * 100)} over the gold value.`,
    });
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
      html += line(
        '−',
        'Old gold',
        `${f3.format(i.oldWeight)} g of ${oldK}K × ${inr(oldRate)}${i.oldDeductPct ? `, less ${pct(i.oldDeductPct)}` : ''}`,
        inr(b.oldValue),
      );
    }
    facts.push({
      tone: '',
      label: 'All-in price',
      value: `${inr(b.total / b.net)}/g`,
      note: 'Gold plus every charge and GST.',
    });
    facts.push({
      tone: '',
      label: 'Charges on top of gold',
      value: pct1(((b.making + b.wastage) / b.gold) * 100 || 0),
      note: 'Making and wastage, as a share of the gold value.',
    });
    if (
      atLive &&
      rateGap(cmp, liveRk, budgetMode ? (atLive.net - b.net) * rate : b.payable - atLive.payable).level !== 'same'
    ) {
      facts.push(
        budgetMode
          ? {
              tone: '',
              label: 'At today’s rate',
              value: `${f3.format(atLive.net)} g`,
              note: 'What the same budget buys at today’s live rate.',
            }
          : {
              tone: '',
              label: 'At today’s rate',
              value: inr(atLive.payable),
              note: `${inr(Math.abs(b.payable - atLive.payable))} ${b.payable > atLive.payable ? 'less' : 'more'} than with your rate.`,
            },
      );
    }
  }
  $('lines').innerHTML = html;
  if (ok) {
    const net = checkMode ? c.net : b.net;
    const paid = checkMode ? c.total : b.total;
    // Buyback pays for gold only, less 2-5%.
    const resale = Math.round(net * (liveRk ? rateOf(k, { k: rk, r: liveRk }) : rate) * (1 - BUYBACK_CUT));
    if (resale > 0 && paid > resale)
      facts.push({
        tone: '',
        label: 'If sold back today',
        value: `about ${inr(resale)}`,
        note: `${inr(paid - resale)} less than you pay: making charges and GST aren’t returned, and shops usually deduct 2% to 5%.`,
      });
    if (i.stoneValue > 0 && i.stoneWt <= 0)
      facts.push({
        tone: 'bad',
        label: 'Stone weight',
        value: 'Not entered',
        note: 'Stones are priced but no stone weight is entered. Check that the bill takes the stone weight off before charging the gold rate.',
      });
  }
  const rank = { bad: 0, good: 1, '': 1 };
  $('facts').innerHTML = facts
    .map((f, n) => ({ ...f, n }))
    .sort((x, y) => rank[x.tone] - rank[y.tone] || x.n - y.n)
    .map(
      (f) =>
        `<li class="fact ${f.tone}"><span class="f-label">${f.label}</span><b class="f-value">${f.value}</b><span class="f-note">${f.note}</span></li>`,
    )
    .join('');
  $('factsTitle').hidden = !facts.length;

  const payable = checkMode ? c.total : b.payable;
  const refund = ok && payable < -0.5;
  const payLabel = checkMode ? 'Bill total' : refund ? 'Shop pays you' : 'Total to pay';
  $('gLabel').textContent = payLabel;
  $('gTotal').textContent = inr(ok ? Math.abs(payable) : 0);

  $('tLabel').textContent = budgetMode ? 'You can buy' : checkMode ? 'Making charges in this bill' : payLabel;
  $('total').textContent = !ok
    ? ''
    : budgetMode
      ? `${f3.format(b.net)} g`
      : checkMode
        ? pct((c.making / c.gold) * 100)
        : inr(Math.abs(b.payable));
  $('amount').textContent = ok && checkMode ? inr(c.making) : '';
  $('words').textContent = !ok
    ? ''
    : budgetMode
      ? `of ${k}K gold for ${inr(b.payable)}`
      : checkMode
        ? `of the gold value of ${inr(c.gold)}`
        : [`${f3.format(b.net)} g of ${k}K`, lakh(Math.abs(b.payable)) && `${lakh(Math.abs(b.payable))} rupees`]
            .filter(Boolean)
            .join(', ');

  $('pan').hidden = !(ok && (checkMode ? c.total : b.total) >= 200000);
  $('share').disabled = !ok;

  last = ok ? { b, k, src, payable, net: checkMode ? c.net : b.net } : null;
  writeUrl();
  scrollers.forEach(fade);
}

function persist() {
  S.f = gather();
  save();
}

form.addEventListener('input', (e) => {
  const el = e.target;
  // Convert before render, which would read the old value in the new unit.
  if (el.name === 'gstUnit' && S.gstCustom != null && lastCheck) {
    S.gstCustom = el.value === 'pct' ? lastCheck.gstPct : lastCheck.gst;
  }
  if (el.name === 'makingUnit' && S.makingCustom != null && lastCheck?.gold > 0) {
    S.makingCustom = el.value === 'pct' ? (lastCheck.making / lastCheck.gold) * 100 : lastCheck.making;
  }
  if (el.inputMode === 'decimal' || el.inputMode === 'numeric') {
    const clean = el.value.replace(el.inputMode === 'numeric' ? /[^\d,]/g : /[^\d.,]/g, '');
    if (clean !== el.value) el.value = clean;
  }
  if (el.id === 'rate')
    S.custom = el.value.trim()
      ? { k: val('rateK'), rate: num(el) / (Number(val('rateUnit')) || 1), at: Date.now() }
      : null;
  if (el.id === 'oldRate') S.oldCustom = el.value.trim() ? num(el) : null;
  if (el.id === 'gstAmount') S.gstCustom = el.value.trim() ? num(el) : null;
  if (el.id === 'makingAmount') S.makingCustom = el.value.trim() ? num(el) : null;
  persist();
  render();
});
form.addEventListener('change', () => {
  persist();
  render();
});

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

$('useLive').onclick = () => {
  S.custom = null;
  save();
  render();
};
$('oldUseLive').onclick = () => {
  S.oldCustom = null;
  save();
  render();
};

const confirmBox = $('confirm');
$('reset').onclick = () => {
  confirmBox.returnValue = '';
  confirmBox.showModal();
};
confirmBox.addEventListener('close', () => {
  if (confirmBox.returnValue !== 'clear') return;
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
// Live rate is cached for 10 minutes; returning to the tab after that refetches.
const FRESH = 10 * 60 * 1000;
const stale = () => Date.now() - (S.live?.fetched || 0) > FRESH;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && stale()) refresh();
});

// Live rates stay out of the URL so a reload or shared link gets the latest.
function stateParams() {
  const f = gather();
  const p = [];
  if (f.mode !== DEFAULTS.mode) p.push(`m=${f.mode}`);
  for (const [name, key] of Object.entries(SHORT)) {
    const v = f[name].replace(/,/g, '');
    if (
      !digits(v) ||
      v === DEFAULTS[name] ||
      (name === 'gross' && f.mode === 'budget') ||
      (name === 'budget' && f.mode !== 'budget') ||
      (name === 'final' && f.mode !== 'check')
    )
      continue;
    p.push(`${key}=${v}`);
  }
  const mk = f.making.replace(/,/g, '');
  if (f.mode !== 'check' && digits(mk) && (mk !== DEFAULTS.making || f.makingMode !== 'pct'))
    p.push(`mk=${mk}${MODE_SUFFIX[f.makingMode]}`);
  const src = source();
  if (S.custom && src.r > 0) {
    p.push(`r=${src.r}${src.k === '22' ? '' : `-${src.k}`}`);
    p.push(`d=${yymmdd(S.custom?.at || S.live?.at || Date.now())}`);
  }
  if (S.oldCustom != null && f.mode !== 'check') p.push(`or=${S.oldCustom}`);
  if (f.mode === 'check') {
    if (S.gstCustom != null) p.push(`${f.gstUnit === 'rs' ? 'ga' : 'gp'}=${+S.gstCustom.toFixed(4)}`);
    else if (f.gstUnit === 'rs') p.push('gu=rs');
    if (S.makingCustom != null) p.push(`ma=${+S.makingCustom.toFixed(4)}${f.makingUnit === 'rs' ? 'r' : ''}`);
    else if (f.makingUnit === 'rs') p.push('mu=rs');
  }
  return p.join('&');
}

// Keep the address bar current. Debounced: Safari rejects more than 100 replaceState calls in 30 s.
let urlTimer;
function flushUrl() {
  clearTimeout(urlTimer);
  const q = stateParams();
  const anchor = /^#(help|h-[\w-]+|bill|form)$/.test(location.hash) ? location.hash : '';
  const next = `${location.pathname}${q ? `?${q}` : ''}${anchor}`;
  if (next !== location.pathname + location.search + location.hash) history.replaceState(null, '', next);
}
function writeUrl() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(flushUrl, 300);
}

const shareLink = () => {
  flushUrl();
  return location.href.split('#')[0];
};

$('share').onclick = async () => {
  if (!last) return;
  const { k, payable, net } = last;
  const url = shareLink();
  const text = `Gold bill: ${f3.format(net)} g of ${k}K, ${payable < -0.5 ? 'shop pays' : 'total'} ${inr(Math.abs(payable))}`;
  const btn = $('share');
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches)
      return await navigator.share({ title: 'Gold bill', text, url });
    await navigator.clipboard.writeText(url);
    btn.textContent = 'Link copied';
  } catch (err) {
    if (err?.name === 'AbortError') return;
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Link copied';
    } catch {
      btn.textContent = 'Couldn’t share. Try again';
    }
  }
  setTimeout(() => (btn.textContent = 'Share bill'), 1800);
};

// One FAQ topic open at a time. <details name> does this natively; this covers older browsers.
for (const d of document.querySelectorAll('details.topic')) {
  d.addEventListener('toggle', () => {
    if (d.open) for (const o of document.querySelectorAll('details.topic[open]')) if (o !== d) o.open = false;
  });
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#h-"], a[href="#help"]');
  const t = a && document.querySelector(a.getAttribute('href'));
  if (t?.tagName === 'DETAILS') t.open = true;
});

const root = document.documentElement;
const isDark = () =>
  root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
const themeLabel = () =>
  $('theme').setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
themeLabel();
$('theme').onclick = () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  themeLabel();
  try {
    localStorage.setItem('theme', root.dataset.theme);
  } catch {}
};

// Desktop result column: stick at the top, or at the bottom once it's taller than the window.
const out = document.querySelector('.out');
const pin = () => out.style.setProperty('--out-top', `${Math.min(24, innerHeight - out.offsetHeight - 24)}px`);
new ResizeObserver(pin).observe(out);
addEventListener('resize', pin);

// Phone result bar: hidden | floating | placed | closing | closed (desktop: static). An observer on
// the bill marks where it lands, so nothing runs on scroll; state is written only on change.
const display = $('display');
const phone = matchMedia('(max-width: 959px)');
let billReached = false,
  closing = false;
function syncBar() {
  const state = display.hidden
    ? 'hidden'
    : !phone.matches
      ? 'static'
      : closing
        ? 'closing'
        : barClosed
          ? 'closed'
          : billReached
            ? 'placed'
            : 'floating';
  if (display.dataset.state === state) return;
  display.dataset.state = state;
  display.setAttribute('role', state === 'floating' ? 'button' : 'region');
  display.tabIndex = state === 'floating' ? 0 : -1;
}
// The bar sits 12px above the bill and floats 8px above the screen edge, so it reaches its
// place when the bill's top is 4px or less below the screen.
new IntersectionObserver(
  ([e]) => {
    billReached = e.isIntersecting || e.boundingClientRect.top < 0;
    syncBar();
  },
  { rootMargin: '0px 0px 4px 0px' },
).observe($('bill'));
phone.addEventListener('change', syncBar);

$('barClose').onclick = () => {
  const finish = () => {
    closing = false;
    barClosed = true;
    syncBar();
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
  closing = true;
  syncBar();
  setTimeout(finish, 220);
};

const toBill = (e) => {
  if (display.dataset.state !== 'floating' || e.target.closest('#barClose')) return;
  if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  $('bill').scrollIntoView({ block: 'start' });
};
display.addEventListener('click', toBill);
display.addEventListener('keydown', toBill);

// Hide the result bar behind the on-screen keyboard.
document.addEventListener('focusin', (e) => {
  if (matchMedia('(pointer: coarse)').matches && e.target.matches('input[inputmode]'))
    document.body.classList.add('typing');
});
document.addEventListener('focusout', () => document.body.classList.remove('typing'));

const scrollers = [...document.querySelectorAll('.presets, .rate-for')];
const fade = (el) => {
  el.style.setProperty('--fl', el.scrollLeft > 1 ? '28px' : '0px');
  el.style.setProperty('--fr', el.scrollLeft + el.clientWidth < el.scrollWidth - 1 ? '28px' : '0px');
};
for (const el of scrollers) el.addEventListener('scroll', () => fade(el), { passive: true });
new ResizeObserver(() => scrollers.forEach(fade)).observe(form);

if (!stale()) liveState = 'live';
$('year').textContent = new Date().getFullYear();
render();
if (stale()) refresh();
