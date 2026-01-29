// Minimal helpers to build and extend Jira ADF content safely.

export function adfDoc(content = []) {
  return { type: 'doc', version: 1, content };
}

export function adfText(text, marks) {
  const node = { type: 'text', text: String(text) };
  if (marks?.length) node.marks = marks;
  return node;
}

export function adfParagraph(text) {
  return { type: 'paragraph', content: [adfText(text)] };
}

export function adfHeading(text, level = 2) {
  return { type: 'heading', attrs: { level }, content: [adfText(text)] };
}

export function adfBulletList(items) {
  return {
    type: 'bulletList',
    content: items.map((t) => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [adfText(t)] }],
    })),
  };
}

export function appendChecklistSection(existingAdf, { markerText, title, items }) {
  const doc = normalizeDoc(existingAdf);
  const existingText = JSON.stringify(doc);
  if (existingText.includes(markerText)) {
    return { updated: false, adf: doc };
  }

  const block = [
    adfParagraph(markerText),
    adfHeading(title, 2),
    adfBulletList(items),
  ];

  doc.content = [...(doc.content || []), ...block];
  return { updated: true, adf: doc };
}

function normalizeDoc(adf) {
  if (!adf || typeof adf !== 'object') return adfDoc([]);
  if (adf.type === 'doc' && Array.isArray(adf.content)) return adf;
  // fallback: wrap unknown structure
  return adfDoc([]);
}


