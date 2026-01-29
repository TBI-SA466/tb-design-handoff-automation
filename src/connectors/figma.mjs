import { httpJson } from '../lib/http.mjs';

function token() {
  const t = process.env.FIGMA_TOKEN;
  if (!t) throw new Error('FIGMA_TOKEN is required');
  return t;
}

export async function figmaGetNodes({ fileKey, nodeIds }) {
  const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
  const url = new URL(`https://api.figma.com/v1/files/${fileKey}/nodes`);
  url.searchParams.set('ids', ids.join(','));
  return httpJson(url.toString(), { headers: { 'X-Figma-Token': token() } });
}


