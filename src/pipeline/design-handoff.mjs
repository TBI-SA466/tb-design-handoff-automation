import path from 'node:path';
import { jiraAddComment, jiraGetIssue, jiraSearchJql } from '../connectors/jira.mjs';
import { figmaGetNodes } from '../connectors/figma.mjs';
import { adfToPlainText } from '../lib/adf.mjs';
import { extractUrls, parseFigmaDesignUrl } from '../lib/links.mjs';
import { writeReport } from '../report/markdown.mjs';

function parseVariantPropsFromName(name) {
  // Common Figma conventions:
  // "State=Default, Checked=On"
  // "Default / On"
  // We'll support the "key=value" comma-separated form first.
  const props = {};
  if (!name) return props;
  const parts = name.split(',').map((s) => s.trim());
  let found = false;
  for (const p of parts) {
    const m = p.match(/^([^=]+)=(.+)$/);
    if (m) {
      found = true;
      props[m[1].trim()] = m[2].trim();
    }
  }
  if (found) return props;

  // Fallback: split by "/" into unnamed buckets
  const slash = name.split('/').map((s) => s.trim()).filter(Boolean);
  if (slash.length) props._variant = slash.join(' / ');
  return props;
}

function collectVariantsFromNode(node) {
  // If node is COMPONENT_SET, variants are usually its children.
  // If node is COMPONENT, it may itself be a variant.
  const variants = [];

  const visit = (n) => {
    if (!n) return;
    const t = n.type;
    if (t === 'COMPONENT' || t === 'COMPONENT_SET') {
      variants.push({
        id: n.id,
        name: n.name || '',
        type: t,
        props: parseVariantPropsFromName(n.name || ''),
      });
    }
    if (Array.isArray(n.children)) {
      for (const c of n.children) visit(c);
    }
  };

  visit(node);
  return variants;
}

function summarizeVariantProperties(variants) {
  const propValues = new Map(); // prop -> Set(values)
  for (const v of variants) {
    for (const [k, val] of Object.entries(v.props || {})) {
      if (!propValues.has(k)) propValues.set(k, new Set());
      propValues.get(k).add(val);
    }
  }
  const summary = {};
  for (const [k, set] of propValues.entries()) summary[k] = [...set].sort();
  return summary;
}

function findAcceptanceCriteriaText(plainText) {
  // Best-effort: pull lines under "Acceptance Criteria" header.
  const lines = (plainText || '').split('\n');
  const idx = lines.findIndex((l) => /acceptance criteria/i.test(l.trim()));
  if (idx < 0) return '';
  const out = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*#/.test(l)) break;
    // stop at another obvious header
    if (/^\s*[A-Z][A-Za-z ]{2,}:\s*$/.test(l)) break;
    out.push(l);
  }
  return out.join('\n').trim();
}

function diffStates({ acText, figmaSummary }) {
  const ac = (acText || '').toLowerCase();
  const mentioned = new Set();
  const allFigmaValues = new Set();

  for (const [k, vals] of Object.entries(figmaSummary)) {
    for (const v of vals) {
      const token = String(v).toLowerCase();
      allFigmaValues.add(token);
      if (ac.includes(token)) mentioned.add(token);
    }
  }

  // Heuristic: find candidate words in AC that look like states.
  // We'll flag words that appear as "StateName" tokens and are not in figma values.
  const acWords = new Set(
    (acText || '')
      .split(/[^a-zA-Z0-9_-]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3)
      .map((w) => w.toLowerCase())
  );

  const figmaMissingInAc = [...allFigmaValues].filter((v) => !mentioned.has(v)).slice(0, 50);
  const acMissingInFigma = [...acWords].filter((w) => {
    // only consider "state-ish" words
    const isStateish = ['default', 'disabled', 'error', 'unavailable', 'hover', 'focus', 'focused', 'loading', 'active'].includes(w) || w.includes('state');
    return isStateish && !allFigmaValues.has(w);
  });

  return { figmaMissingInAc, acMissingInFigma };
}

export async function runDesignHandoff({ outDir, issueKey, jql }) {
  const issues = [];
  if (issueKey) {
    issues.push(await jiraGetIssue(issueKey));
  } else {
    const query = jql || process.env.DEFAULT_JQL || 'order by updated DESC';
    const res = await jiraSearchJql(query, { maxResults: 25 });
    issues.push(...(res.issues || []));
  }

  const reportRows = [];

  for (const issue of issues) {
    const key = issue.key;
    const summary = issue.fields?.summary || '';
    const descPlain = adfToPlainText(issue.fields?.description);
    const textBlob = `${summary}\n${descPlain}`;

    const urls = extractUrls(textBlob);
    const figmaLinks = urls.map(parseFigmaDesignUrl).filter(Boolean);

    if (!figmaLinks.length) {
      reportRows.push(`| ${key} | no figma link | — |`);
      continue;
    }

    // For v1: use the first Figma link as the primary node.
    const primary = figmaLinks[0];
    const figmaRes = await figmaGetNodes({ fileKey: primary.fileKey, nodeIds: [primary.nodeId] });
    const node = figmaRes?.nodes?.[primary.nodeId]?.document;

    const variants = node ? collectVariantsFromNode(node) : [];
    const figmaSummary = summarizeVariantProperties(variants);

    const acText = findAcceptanceCriteriaText(descPlain);
    const { figmaMissingInAc, acMissingInFigma } = diffStates({ acText, figmaSummary });

    const confluenceLink = process.env.CONFLUENCE_HANDOFF_PAGE_URL;
    const commentLines = [];
    commentLines.push(`Design handoff automation summary`);
    commentLines.push(``);
    commentLines.push(`Jira: ${key} - ${summary}`);
    commentLines.push(`Figma: https://www.figma.com/design/${primary.fileKey}?node-id=${primary.nodeId.replace(':', '-')}`);
    if (confluenceLink) commentLines.push(`Confluence handoff: ${confluenceLink}`);
    commentLines.push(``);
    commentLines.push(`Extracted variant properties (best-effort):`);
    for (const [k, vals] of Object.entries(figmaSummary)) {
      commentLines.push(`- ${k}: ${vals.join(', ')}`);
    }
    if (!Object.keys(figmaSummary).length) commentLines.push(`- (none detected; node may not be a component set/variant)`);
    commentLines.push(``);
    if (acText) {
      commentLines.push(`Acceptance Criteria section detected ✅`);
    } else {
      commentLines.push(`Acceptance Criteria section detected ❌ (could not find "Acceptance Criteria" header)`);
    }
    commentLines.push(``);
    commentLines.push(`Discrepancies (heuristic):`);
    commentLines.push(`- Values in Figma not mentioned in AC: ${figmaMissingInAc.length ? figmaMissingInAc.join(', ') : 'None'}`);
    commentLines.push(`- Values mentioned in AC but not found in Figma: ${acMissingInFigma.length ? acMissingInFigma.join(', ') : 'None'}`);

    await jiraAddComment(key, commentLines.join('\n'));

    reportRows.push(`| ${key} | ${primary.fileKey}:${primary.nodeId} | ${Object.keys(figmaSummary).length} props |`);
  }

  writeReport({
    outFile: path.join(outDir, 'design-handoff.md'),
    title: 'Figma ↔ Jira design handoff report',
    sections: [
      {
        title: 'Summary',
        body: [
          `- Issues processed: ${issues.length}`,
          `- Mode: ${issueKey ? `single issue (${issueKey})` : 'JQL search'}`,
        ].join('\n'),
      },
      {
        title: 'Results',
        body: [
          '| issue | figma | extracted |',
          '|---|---|---|',
          ...reportRows,
        ].join('\n'),
      },
      {
        title: 'Notes',
        body: [
          '- This version uses best-effort parsing of Figma node/component names.',
          '- Next upgrade: enumerate all variants from a Component Set and write a richer “state matrix”.',
        ].join('\n'),
      },
    ],
  });
}


