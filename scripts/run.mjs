import fs from 'node:fs';
import path from 'node:path';
import { runDesignHandoff } from '../src/pipeline/design-handoff.mjs';
import { jiraGetIssueKeysInEpic } from '../src/connectors/jira.mjs';
import { jiraGetIssueKeysInEpic } from '../src/connectors/jira.mjs';

/** Load .env from project root into process.env (so clone + copy .env works without extra steps). */
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

loadEnv();

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

  const issueArg = args.issue;
  const epicKey = args.epic ? args.epic.trim() : null;
  let issueKeys = issueArg ? issueArg.split(',').map((k) => k.trim()).filter(Boolean) : null;
  const jql = args.jql;
  const dryRun = String(args['dry-run'] || '').toLowerCase() === 'true';

  if (epicKey) {
    const childKeys = await jiraGetIssueKeysInEpic(epicKey);
    if (!childKeys.length) {
      throw new Error(`Epic ${epicKey}: no child issues found. Check EPIC_CHILD_JQL if you use "Epic Link" instead of parent.`);
    }
    issueKeys = childKeys;
  }

  if (!issueKeys?.length && !jql && !process.env.DEFAULT_JQL) {
    throw new Error('Provide --issue=RFW-123, --issue=KEY1,KEY2,..., --epic=RFW-100, or --jql="..." or set DEFAULT_JQL in env');
  }

  await runDesignHandoff({ outDir, issueKeys, jql, dryRun, epicKey });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e?.message || e);
  process.exit(1);
});


