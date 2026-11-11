export const OZ = 31.1034768;

// Fineness per BIS hallmark grade (IS 1417).
export const PURITY = { 24: 999, 22: 916, 20: 833, 18: 750, 14: 585, 9: 375 };

export const rateFor = (base999, k) => (base999 * PURITY[k]) / 999;

// Indian landed rate: international spot plus customs duty plus local premium. Excludes GST, like board rates.
export const landed = (inrPerOz, dutyPct, premium) => (inrPerOz / OZ) * (1 + dutyPct / 100) + premium;

const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
const r = Math.round;

// Each line is rounded to the rupee, as on a jeweller's invoice, so the lines add up to the total.
// Per CBIC FAQ, retail jewellery attracts 3% GST on the whole value, making included.
export function bill(i) {
  const net = Math.max(0, n(i.gross) - n(i.stoneWt));
  const gold = r(net * n(i.rate));
  const wastage = r((gold * n(i.wastagePct)) / 100);
  const makingFull = r(i.makingMode === 'pct' ? (gold * n(i.making)) / 100 : i.makingMode === 'gram' ? net * n(i.making) : n(i.making));
  const discount = r((makingFull * Math.min(100, n(i.discountPct))) / 100);
  const making = makingFull - discount;
  const taxable = gold + wastage + making + r(n(i.stoneValue)) + r(n(i.hallmark));
  const gst = r((taxable * n(i.gstPct)) / 100);
  const total = taxable + gst;
  const oldValue = r(n(i.oldWeight) * n(i.oldRate) * (1 - Math.min(100, n(i.oldDeductPct)) / 100));
  return { net, gold, wastage, makingFull, discount, making, taxable, gst, total, oldValue, payable: total - oldValue };
}

// Largest net weight (to 1 mg) whose payable fits the budget. Solves the linear bill, then steps
// by 1 mg to absorb per-line rounding.
export function maxNet(budget, i) {
  const d = 1 - Math.min(100, n(i.discountPct)) / 100;
  const rate = n(i.rate);
  const perGram =
    rate * (1 + n(i.wastagePct) / 100) + (i.makingMode === 'pct' ? (rate * n(i.making) * d) / 100 : i.makingMode === 'gram' ? n(i.making) * d : 0);
  if (perGram <= 0) return 0;
  const fixed = n(i.stoneValue) + n(i.hallmark) + (i.makingMode === 'flat' ? n(i.making) * d : 0);
  const oldValue = n(i.oldWeight) * n(i.oldRate) * (1 - Math.min(100, n(i.oldDeductPct)) / 100);
  const fits = (mg) => bill({ ...i, stoneWt: 0, gross: mg / 1000 }).payable <= n(budget);
  let mg = Math.max(0, Math.floor((((n(budget) + oldValue) / (1 + n(i.gstPct) / 100) - fixed) / perGram) * 1000));
  while (mg > 0 && !fits(mg)) mg--;
  while (fits(mg + 1)) mg++;
  return mg > 0 && fits(mg) ? mg / 1000 : 0;
}

// Reverse of bill(): split a jeweller's final total (with GST) into its parts. GST and making
// (as an amount or a % of gold) come from the bill when given, 0 included; otherwise GST is gstPct of the price before GST and making is
// whatever is left after gold, wastage, stones and hallmark. Anything the stated making doesn't
// cover is `other`.
export function fromTotal(total, i) {
  const net = Math.max(0, n(i.gross) - n(i.stoneWt));
  const gold = r(net * n(i.rate));
  const wastage = r((gold * n(i.wastagePct)) / 100);
  const stones = r(n(i.stoneValue));
  const hallmark = r(n(i.hallmark));
  const sum = r(n(total));
  const gst = i.gstAmount != null ? r(n(i.gstAmount)) : sum - r(sum / (1 + n(i.gstPct) / 100));
  const taxable = sum - gst;
  const rest = taxable - gold - wastage - stones - hallmark;
  const making = i.makingPct != null ? r((gold * n(i.makingPct)) / 100) : i.makingAmount != null ? r(n(i.makingAmount)) : rest;
  return { net, gold, wastage, stones, hallmark, making, other: rest - making, taxable, gst, gstPct: taxable > 0 ? (gst / taxable) * 100 : 0, total: sum };
}
