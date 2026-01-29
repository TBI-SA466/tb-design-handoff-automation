export function extractUrls(text) {
  if (!text) return [];
  const urls = new Set();
  const re = /\bhttps?:\/\/[^\s<>"')]+/gi;
  let m;
  while ((m = re.exec(text))) {
    const u = m[0].replace(/[.,;:)\]]+$/g, '');
    urls.add(u);
  }
  return [...urls];
}

export function parseFigmaDesignUrl(url) {
  // https://www.figma.com/design/<fileKey>/<name>?node-id=62-31062&m=dev
  try {
    const u = new URL(url);
    if (u.host !== 'www.figma.com' && u.host !== 'figma.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'design') return null;
    const fileKey = parts[1];
    const nodeIdParam = u.searchParams.get('node-id'); // "62-31062"
    const nodeId = nodeIdParam ? nodeIdParam.replace('-', ':') : undefined;
    if (!fileKey || !nodeId) return null;
    return { fileKey, nodeId };
  } catch {
    return null;
  }
}


