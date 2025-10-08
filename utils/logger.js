export const logStart = (name, meta = {}) =>
  console.log(`▶ ${name}()`, meta && Object.keys(meta).length ? meta : "");

export const logOk = (name, meta = {}) =>
  console.log(`✓ ${name}`, meta && Object.keys(meta).length ? meta : "");

export const logWarn = (name, err) =>
  console.warn(`⚠️ ${name}`, typeof err === "string" ? err : (err?.message || err));

export const logErr = (name, err) =>
  console.error(`✖ ${name}`, typeof err === "string" ? err : (err?.message || err));