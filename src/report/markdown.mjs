import fs from 'node:fs';
import path from 'node:path';

export function writeReport({ outFile, title, sections }) {
  const lines = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  for (const s of sections) {
    lines.push(`## ${s.title}`);
    lines.push('');
    if (s.body) lines.push(String(s.body).trimEnd());
    lines.push('');
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
}


