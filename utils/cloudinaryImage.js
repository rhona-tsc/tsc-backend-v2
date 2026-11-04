/** Delivery only: never persist this URL over the uploaded original or use for downloads.
 * Kept identical across independently deployed TSC applications.
 */
export function cloudinaryImage(source, width = 1200) {
  if (typeof source !== 'string') return source;
  const match = source.match(/^(https?:\/\/res\.cloudinary\.com\/[^/?#]+\/image\/upload\/)([^?#]+)([?#].*)?$/);
  if (!match || /(?:^|\/)s--[^/]+--(?:\/|$)/.test(match[2]) || /(?:^|[,/])fl_attachment(?::|[,/]|$)/.test(match[2])) return source;
  // Documents and vector originals have distinct delivery requirements.
  if (/\.(?:pdf|svg|eps|ai|psd|tiff?|mp4|webm|mov|m4v|avi|mp3|wav|ogg|aac|flac|aiff|m4a)(?:$)/i.test(match[2])) return source;
  const parts = match[2].split('/');
  const transformation = /^(?:(?:a|ac|ar|b|bo|c|co|cs|d|dl|dn|dpr|du|e|eo|f|fl|fn|fps|g|h|if|ki|l|o|p|pg|q|r|so|t|u|vc|vs|w|x|y|z)_|\$)[^/]+$/;
  let end = 0;
  while (end < parts.length - 1 && transformation.test(parts[end]) && !/^v\d+$/.test(parts[end])) end++;
  const steps = parts.slice(0, end);
  const asset = parts.slice(end).join('/');
  // Replace only a terminal delivery limit; never remove a crop or an effect.
  while (steps.length && /^c_limit,w_\d+(?:,(?:f_auto|q_auto))*$/.test(steps.at(-1))) steps.pop();
  const quality = steps.some(step => /(?:^|,)q_(?:auto:best|9\d|100)(?:,|$)/.test(step)) ? 'q_auto:best' : 'q_auto';
  const size = Number.isFinite(Number(width)) && Number(width) > 0 ? Math.round(Number(width)) : 1200;
  // Append after all existing crops/overlays, preserving their coordinate system.
  // Recognise our suffix to make repeated calls idempotent (including srcset).
  if (steps.at(-1) === 'f_auto' && /^q_auto(?::best)?$/.test(steps.at(-2) || '') && /^c_limit,w_\d+$/.test(steps.at(-3) || '')) steps.splice(-3);
  return match[1] + [...steps, 'c_limit,w_' + size, quality, 'f_auto', asset].join('/') + (match[3] || '');
}
