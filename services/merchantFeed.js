import { publicActStatuses } from '../utils/publicActStatuses.js';

const origin = 'https://thesupremecollective.co.uk';
const columns = ['id', 'title', 'description', 'availability', 'link', 'mobile_link', 'image_link', 'price', 'brand', 'identifier_exists'];

const plain = value => String(value || '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();

const publicImage = value => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
};

export function merchantProduct(act) {
  const slug = String(act.slug || '').trim();
  const title = plain(act.tscName);
  const description = plain(act.tscDescription);
  // This is the website's customer-facing starting price, already marked up.
  // Do not export supplier rates or apply the company margin a second time.
  const price = Number(act.minDisplayPrice);
  const image = [...(act.coverImage || []), ...(act.images || [])]
    .map(item => publicImage(item?.url)).find(Boolean);
  if (!publicActStatuses.includes(act.status) || act.isTest === true ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || /^test(?:-|$)/i.test(slug) ||
      /^test(?:\s|[-_]|$)/i.test(title) || !act._id || !title || !description ||
      !image || !Number.isFinite(price) || price <= 0) return null;
  const link = `${origin}/act/${slug}/`;
  // Explicit allowlist: no musician identities, contact details or fees enter the feed.
  return { id: String(act._id), title, description, availability: 'in_stock', link,
    mobile_link: link, image_link: image, price: `${Math.round(price).toFixed(2)} GBP`,
    brand: 'The Supreme Collective', identifier_exists: 'no' };
}

const tsv = value => {
  const text = String(value).replace(/[\t\r\n]+/g, ' ');
  return text.includes('"') ? `"${text.replace(/"/g, '""')}"` : text;
};

export function buildMerchantFeed(acts) {
  const products = acts.map(merchantProduct).filter(Boolean);
  // A failed or empty database read must not publish an empty replacement catalogue.
  if (!products.length) throw new Error('No publishable products available');
  return [columns.join('\t'), ...products.map(product => columns.map(key => tsv(product[key])).join('\t'))].join('\n') + '\n';
}
