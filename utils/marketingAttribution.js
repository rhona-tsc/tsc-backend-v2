const allowedChannels = new Set(['Google Ads', 'Google organic', 'Campaign', 'Referral', 'Direct / unknown']);
const clean = (value, max = 160) => {
  if (typeof value !== 'string' || value.includes('@')) return '';
  return value.replace(/[\x00-\x1f\x7f<>]/g, '').trim().slice(0, max);
};
export function normalizeAttribution(value, now = new Date()) {
  if (!value || typeof value !== 'object') return undefined;
  const consentGranted = value.consentGranted === true;
  function touch(input) {
    if (!input || !allowedChannels.has(input.channel)) return undefined;
    const date = new Date(input.capturedAt);
    if (!Number.isFinite(date.getTime()) || date > now || now - date > 90 * 86400000) return undefined;
    const result = { channel: input.channel, source: clean(input.source), medium: clean(input.medium), capturedAt: date.toISOString() };
    if (consentGranted) {
      for (const key of ['campaign', 'content', 'keyword', 'campaignId', 'adGroupId', 'adId', 'matchType', 'network', 'device']) result[key] = clean(input[key]);
      for (const key of ['gclid', 'gbraid', 'wbraid']) if (/^[a-zA-Z0-9_-]{1,512}$/.test(input[key] || '')) result[key] = input[key];
      if (/^\/(?:acts|act\/[a-z0-9-]+|wedding-bands-[a-z-]+|about|contact|blog(?:\/[a-z0-9-]+)?|venues)?\/?$/i.test(input.landingPath || '')) result.landingPath = input.landingPath.slice(0, 200);
      if (/^[a-z0-9.-]{1,253}$/i.test(input.referrerHost || '')) result.referrerHost = input.referrerHost;
    }
    return result;
  }
  const firstTouch = touch(value.firstTouch), lastTouch = touch(value.lastTouch);
  if (!firstTouch && !lastTouch) return undefined;
  return { version: 1, consentGranted, firstTouch: firstTouch || lastTouch, lastTouch: lastTouch || firstTouch };
}
export function attributionSource(value) { return value?.lastTouch?.channel || value?.firstTouch?.channel || ''; }
