import fs from 'node:fs';
import path from 'node:path';
import { runDesignHandoff } from '../src/pipeline/design-handoff.mjs';

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(process.cwd(), 'reports');
  fs.mkdirSync(outDir, { recursive: true });

  const issueKey = args.issue;
  const jql = args.jql;
  const dryRun = String(args['dry-run'] || '').toLowerCase() === 'true';

  if (!issueKey && !jql && !process.env.DEFAULT_JQL) {
    throw new Error('Provide --issue=RFW-123 or --jql="..." or set DEFAULT_JQL in env');
  }

  await runDesignHandoff({ outDir, issueKey, jql, dryRun });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e?.message || e);
  process.exit(1);
});


