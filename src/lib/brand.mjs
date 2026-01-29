export function parseBrandFileKeyMap(envValue) {
  // Example:
  // FIGMA_BRAND_FILE_KEYS="tmw=w2YK...,jab=abcd...,msp=efgh..."
  const out = new Map(); // fileKey -> brand
  if (!envValue) return out;
  for (const entry of envValue.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [brand, fileKey] = entry.split('=').map((s) => s.trim());
    if (brand && fileKey) out.set(fileKey, brand);
  }
  return out;
}

export function brandForFileKey(fileKey, map) {
  return map.get(fileKey) || 'unknown';
}


