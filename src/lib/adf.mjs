// Jira Cloud description is often Atlassian Document Format (ADF).
// This helper extracts best-effort plain text for lightweight analysis.

export function adfToPlainText(adf) {
  if (!adf) return '';
  if (typeof adf === 'string') return adf;
  const out = [];
  walk(adf, out);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

function walk(node, out) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, out);
    return;
  }
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (node.type === 'text' && typeof node.text === 'string') {
    out.push(node.text);
    return;
  }
  if (node.type === 'hardBreak') {
    out.push('\n');
    return;
  }
  if (node.type === 'paragraph') {
    if (node.content) walk(node.content, out);
    out.push('\n');
    return;
  }
  if (node.type === 'heading') {
    if (node.content) walk(node.content, out);
    out.push('\n');
    return;
  }
  if (node.type === 'listItem') {
    out.push('- ');
    if (node.content) walk(node.content, out);
    out.push('\n');
    return;
  }
  if (node.content) walk(node.content, out);
}


