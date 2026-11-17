// Complete supplier fees from the master include travel. Never add member/travel fees again.
export const countyKey = value => {
  const key = String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  return ({ greaterlondon: 'london', greatermanchester: 'manchester', countydurham: 'durham', cityofbristol: 'bristol', eastridingofyorkshire: 'eastyorkshire', cityofedinburgh: 'edinburgh', edinburghcity: 'edinburgh', glasgowcity: 'glasgow', conway: 'conwy' })[key] || key;
};

export function minimumSupplierPrice(act) {
  const prices = Object.values(act?.supplierPricing?.lineups || {}).flatMap(lineup => Object.values(lineup.counties || {}))
    .filter(price => typeof price === 'number' && Number.isFinite(price) && price > 0);
  return prices.length ? Math.min(...prices) : null;
}

// A fixed direct-booking saving per lineup, classified by its normal London guide.
// Supplier fees remain untouched, including the county travel already in those fees.
export const normalWebsitePrice = supplierPrice => Math.ceil(Math.round(supplierPrice * 100) * 133 / 10000);
export const directBookingSaving = normalGuide => normalGuide > 0 ? (normalGuide < 2500 ? 50 : 100) : 0;

export function lineupSaving(entry) {
  const london = Object.entries(entry?.counties || {}).find(([county]) => countyKey(county) === 'london')?.[1];
  return Number.isFinite(london) && london > 0 ? directBookingSaving(normalWebsitePrice(london)) : 0;
}

export function minimumCustomerPrice(act) {
  const prices = Object.values(act?.supplierPricing?.lineups || {}).flatMap(entry => {
    const saving = lineupSaving(entry);
    return Object.values(entry.counties || {}).filter(price => Number.isFinite(price) && price > 0)
      .map(price => Math.max(0, normalWebsitePrice(price) - saving));
  }).filter(price => price > 0);
  return prices.length ? Math.min(...prices) : null;
}

export function supplierQuote(act, lineup, county) {
  const id = String(lineup?.lineupId || lineup?._id || '');
  const entry = act?.supplierPricing?.lineups?.[id];
  if (!entry) return undefined; // Unmapped lineups retain their existing pricing.
  const requestedCounty = countyKey(county);
  const prices = Object.entries(entry.counties || {});
  const supplierPrice = requestedCounty
    ? prices.find(([name]) => countyKey(name) === requestedCounty)?.[1]
    : Math.min(...prices.map(([, price]) => price).filter(price => Number.isFinite(price) && price > 0));
  if (!(typeof supplierPrice === 'number' && Number.isFinite(supplierPrice) && supplierPrice > 0)) {
    return { total: null, fee: null, travel: 0, travelCalculated: false, decision: 'master-rate-unavailable', marginApplied: true };
  }
  const standardTotal = normalWebsitePrice(supplierPrice);
  const saving = lineupSaving(entry);
  const total = Math.max(0, standardTotal - saving);
  return { total, fee: total, travel: 0, supplierPrice, standardTotal, directBookingSaving: saving, subtotalBeforeMarkup: supplierPrice,
    baseFeeTotal: supplierPrice, travelFeeTotal: 0, travelCalculated: !!requestedCounty,
    decision: 'master-supplier-price', markupMultiplier: 1.33, marginApplied: true };
}

// Older pricing paths return supplier fees. Master quotes explicitly carry their applied margin.
export const customerPrice = result => result?.marginApplied === true
  ? Number(result.total) || 0 : Math.ceil((Number(result?.total) || 0) * 1.33);
