export const locationImageUrl = act => {
  const image = act.images?.[0];
  const source = image?.url || act.coverImage?.[0]?.url || '';
  if (!source.startsWith('https://res.cloudinary.com/') || !source.includes('/upload/')) return source;
  const crop = image?.locationCrop;
  const values = crop && [crop.x, crop.y, crop.width, crop.height].map(Number);
  const valid = values && values.every(value => Number.isFinite(value) && value >= 0 && value <= 100000) && values[2] >= 1 && values[3] >= 1;
  const region = valid ? `c_crop,g_north_west,x_${Math.round(values[0])},y_${Math.round(values[1])},w_${Math.round(values[2])},h_${Math.round(values[3])}/` : '';
  return source.replace('/upload/', `/upload/${region}c_limit,w_960,f_auto,q_auto/`);
};
