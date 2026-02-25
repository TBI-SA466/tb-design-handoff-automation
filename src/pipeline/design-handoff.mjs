
import fs from 'node:fs';
import path from 'node:path';
import { jiraAddAttachments, jiraAddCommentAdf, jiraGetIssue, jiraSearchJql, jiraUpdateIssueDescription, jiraUpdateIssueLabels } from '../connectors/jira.mjs';
import { figmaGetNodes } from '../connectors/figma.mjs';
import { adfToPlainText } from '../lib/adf.mjs';
import { extractUrls, parseFigmaDesignUrl } from '../lib/links.mjs';
import { writeReport } from '../report/markdown.mjs';
import { buildHandoffHtml } from '../report/handoff-html.mjs';
import { checkAccessibilityRequirements } from '../lib/a11y.mjs';
import { notifyIfConfigured } from '../lib/notify.mjs';
import { parseBrandFileKeyMap, brandForFileKey } from '../lib/brand.mjs';
import { adfDoc, adfHeading, adfParagraph, adfBulletList, appendChecklistSection } from '../lib/jira-adf-build.mjs';
import { applyExclusiveDesignHandoffLabels, computeDesignHandoffLabels } from '../lib/jira-labels.mjs';

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

/** True if the line looks like an Acceptance Criteria header (full phrase, A/C, AC, a/c, ac). */
function isAcceptanceCriteriaHeader(line) {
  const t = line.trim();
  if (/acceptance\s+criteria/i.test(t)) return true;
  if (/^A\s*\/\s*C\s*:?\s*$/i.test(t)) return true; // A/C or A / C, optional colon
  if (/^AC\s*:?\s*$/i.test(t)) return true;          // AC, optional colon
  return false;
}

function findAcceptanceCriteriaText(plainText) {
  // Best-effort: pull lines under "Acceptance Criteria" header (or A/C, AC, a/c, ac).
  const lines = (plainText || '').split('\n');
  const idx = lines.findIndex((l) => isAcceptanceCriteriaHeader(l));
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

export async function runDesignHandoff({ outDir, issueKeys, jql, dryRun = false, epicKey = null }) {
  const issues = [];
  if (issueKeys?.length) {
    for (const key of issueKeys) {
      issues.push(await jiraGetIssue(key));
    }
  } else {
    const query = jql || process.env.DEFAULT_JQL || 'order by updated DESC';
    const res = await jiraSearchJql(query, { maxResults: 25 });
    // Pull full issue details so we can read labels/attachments safely.
    for (const i of res.issues || []) {
      issues.push(await jiraGetIssue(i.key));
    }
  }

  const reportRows = [];
  const warningsCountByIssue = new Map();
  const dryRunComments = []; // When dryRun: collect would-be Jira comment text per issue
  const dryRunResults = []; // When dryRun: per-ticket results and mismatches for text file
  const brandMap = parseBrandFileKeyMap(process.env.FIGMA_BRAND_FILE_KEYS);
  const writeBack = String(process.env.WRITE_BACK ?? 'true').toLowerCase() !== 'false';
  const labelAutomation = String(process.env.JIRA_LABEL_AUTOMATION ?? 'true').toLowerCase() !== 'false';
  const attachEvidence = String(process.env.JIRA_ATTACH_EVIDENCE ?? 'true').toLowerCase() !== 'false';

  for (const issue of issues) {
    const key = issue.key;
    const summary = issue.fields?.summary || '';
    const descPlain = adfToPlainText(issue.fields?.description);
    const textBlob = `${summary}\n${descPlain}`;

    const urls = extractUrls(textBlob);
    const figmaLinksAll = urls.map(parseFigmaDesignUrl).filter(Boolean);
    const uniqueFigma = new Map(); // `${fileKey}:${nodeId}` -> {fileKey,nodeId}
    for (const f of figmaLinksAll) uniqueFigma.set(`${f.fileKey}:${f.nodeId}`, f);
    const figmaLinks = [...uniqueFigma.values()];

    if (!figmaLinks.length) {
      reportRows.push(`| ${key} | no figma link | — |`);
      if (dryRun) {
        dryRunResults.push({ key, summary, noFigmaLink: true, warnings: [], figmaMissingInAc: [], acMissingInFigma: [], a11yMissing: [], extractedProps: {} });
      }
      continue;
    }

    // Fetch all referenced nodes grouped by fileKey (multi-file support).
    const byFile = new Map(); // fileKey -> nodeIds[]
    for (const f of figmaLinks) {
      if (!byFile.has(f.fileKey)) byFile.set(f.fileKey, []);
      byFile.get(f.fileKey).push(f.nodeId);
    }

    const nodeSummaries = []; // {brand,fileKey,nodeId,nodeName,type,figmaSummary}
    for (const [fileKey, nodeIds] of byFile.entries()) {
      const res = await figmaGetNodes({ fileKey, nodeIds });
      for (const nodeId of nodeIds) {
        const node = res?.nodes?.[nodeId]?.document;
        const variants = node ? collectVariantsFromNode(node) : [];
        const figmaSummary = summarizeVariantProperties(variants);
        const brand = brandForFileKey(fileKey, brandMap);
        nodeSummaries.push({
          brand,
          fileKey,
          nodeId,
          nodeName: node?.name || '',
          nodeType: node?.type || '',
          figmaSummary,
        });
      }
    }

    // Conflict detection
    const warnings = [];
    if (figmaLinksAll.length > figmaLinks.length) {
      warnings.push(`Duplicate Figma links detected (${figmaLinksAll.length} total, ${figmaLinks.length} unique).`);
    }
    if (byFile.size > 1) {
      warnings.push(`Multiple Figma files referenced in the same ticket (files: ${[...byFile.keys()].join(', ')}).`);
    }
    const uniqueNodeNames = [...new Set(nodeSummaries.map((n) => n.nodeName).filter(Boolean))];
    if (uniqueNodeNames.length > 1) {
      warnings.push(`Multiple different Figma nodes referenced (names: ${uniqueNodeNames.slice(0, 5).join(' | ')}).`);
    }

    // Choose a "primary" summary (first node) for AC comparison, but keep all for reporting.
    const primary = nodeSummaries[0];
    const primarySummary = primary?.figmaSummary || {};

    const acText = findAcceptanceCriteriaText(descPlain);
    const { figmaMissingInAc, acMissingInFigma } = diffStates({ acText, figmaSummary: primarySummary });
    const a11y = checkAccessibilityRequirements(acText || descPlain);
    if (a11y.missing.length) {
      warnings.push(`Missing accessibility requirements in AC: ${a11y.missing.map((m) => m.key).join(', ')}`);
    }

    // Multi-brand diffs: compare property/value sets across brands if multiple brands present.
    const byBrand = new Map(); // brand -> merged summary
    for (const n of nodeSummaries) {
      const b = n.brand || 'unknown';
      if (!byBrand.has(b)) byBrand.set(b, {});
      const agg = byBrand.get(b);
      for (const [k, vals] of Object.entries(n.figmaSummary || {})) {
        if (!agg[k]) agg[k] = new Set();
        for (const v of vals) agg[k].add(v);
      }
    }
    const brandDiffs = [];
    if (byBrand.size > 1) {
      const allProps = new Set();
      for (const agg of byBrand.values()) for (const k of Object.keys(agg)) allProps.add(k);
      for (const prop of [...allProps].sort()) {
        const rows = [];
        for (const [b, agg] of byBrand.entries()) {
          const vals = agg[prop] ? [...agg[prop]].sort() : [];
          rows.push(`${b}=[${vals.join(', ')}]`);
        }
        const normalized = new Set(rows.map((r) => r.replace(/^[^=]+=/, '')));
        if (normalized.size > 1) brandDiffs.push(`${prop}: ${rows.join(' | ')}`);
      }
      if (brandDiffs.length) warnings.push(`Brand diffs detected (${brandDiffs.length}).`);
    }

    // Checklist auto-insert (idempotent, only if WRITE_BACK and not dry-run)
    let checklistInserted = false;
    const checklistMarker = '<!-- design-handoff-checklist -->';
    const checklistTitle = 'Design Handoff Checklist';
    const checklistItems = [
      'Figma link present (component node / component set)',
      'States/variants listed (Default/Disabled/Error/Unavailable/etc.)',
      'Responsive behavior defined (mobile/desktop)',
      'Accessibility: keyboard, focus, ARIA, error messaging, hit area',
      'QA notes / test plan included',
    ];
    const existingAdf = issue.fields?.description;
    const { updated: willInsert, adf: updatedAdf } = appendChecklistSection(existingAdf, {
      markerText: checklistMarker,
      title: checklistTitle,
      items: checklistItems,
    });
    if (willInsert && writeBack && !dryRun) {
      await jiraUpdateIssueDescription(key, updatedAdf);
      checklistInserted = true;
      warnings.push('Inserted Design Handoff Checklist into Jira description.');
    }

    const confluenceLink = process.env.CONFLUENCE_HANDOFF_PAGE_URL;
    const jiraLink = process.env.JIRA_BASE_URL ? `${process.env.JIRA_BASE_URL.replace(/\/+$/, '')}/browse/${key}` : key;

    const adf = adfDoc([
      adfHeading('Design handoff automation summary', 2),
      adfParagraph(`Jira: ${key} - ${summary}`),
      ...nodeSummaries.slice(0, 5).flatMap((n, idx) => [
        adfParagraph(`Figma(${idx + 1}): https://www.figma.com/design/${n.fileKey}?node-id=${n.nodeId.replace(':', '-')}`),
      ]),
      ...(confluenceLink ? [adfParagraph(`Confluence handoff: ${confluenceLink}`)] : []),
      adfHeading('Extracted variant properties (best-effort)', 3),
      ...(Object.keys(primarySummary).length
        ? Object.entries(primarySummary).map(([k, vals]) => adfParagraph(`${k}: ${vals.join(', ')}`))
        : [adfParagraph('(none detected; node may not be a component set/variant)')]),
      adfHeading('Discrepancies (heuristic)', 3),
      adfBulletList([
        `Values in Figma not mentioned in AC: ${figmaMissingInAc.length ? figmaMissingInAc.join(', ') : 'None'}`,
        `Values mentioned in AC but not found in Figma: ${acMissingInFigma.length ? acMissingInFigma.join(', ') : 'None'}`,
      ]),
      adfHeading('Accessibility checks (AC)', 3),
      ...(a11y.missing.length
        ? [adfParagraph(`Missing: ${a11y.missing.map((m) => m.key).join(', ')}`)]
        : [adfParagraph('No missing accessibility requirements detected (heuristic).')]),
      ...(warnings.length ? [adfHeading('Warnings', 3), adfBulletList(warnings)] : []),
      adfParagraph('<!-- design-handoff-bot -->'),
    ]);

    warningsCountByIssue.set(key, warnings.length);

    if (dryRun) {
      dryRunComments.push({ key, text: adfToPlainText(adf) });
      dryRunResults.push({
        key,
        summary,
        figmaLinks: figmaLinks.map((f) => `https://www.figma.com/design/${f.fileKey}?node-id=${f.nodeId.replace(':', '-')}`),
        extractedProps: primarySummary,
        figmaMissingInAc,
        acMissingInFigma,
        a11yMissing: a11y.missing.map((m) => m.key),
        warnings,
        noFigmaLink: false,
      });
    }
    if (writeBack && !dryRun) {
      await jiraAddCommentAdf(key, adf);
    }

    // Jira label automation (exclusive family labels)
    const hasAc = Boolean(acText);
    if (writeBack && !dryRun && labelAutomation) {
      const desired = computeDesignHandoffLabels({ hasAc, warningsCount: warnings.length }).primary;
      const next = applyExclusiveDesignHandoffLabels(issue.fields?.labels || [], desired);
      await jiraUpdateIssueLabels(key, next);
    }

    if (warnings.length) {
      await notifyIfConfigured({
        title: `Design handoff drift detected: ${key}`,
        text: warnings.slice(0, 8).map((w) => `- ${w}`).join('\n'),
        url: jiraLink,
      });
    }

    reportRows.push(`| ${key} | ${nodeSummaries.map((n) => `${n.brand}:${n.fileKey}:${n.nodeId}`).join('<br/>')} | ${Object.keys(primarySummary).length} props | ${warnings.length} | ${checklistInserted ? 'Yes' : 'No'} |`);

    // Generate a per-issue SVG “snapshot” and link it in the report for quick reading.
    const svgName = `handoff.${key}.svg`;
    fs.writeFileSync(path.join(outDir, svgName), buildHandoffSvg({ key, warnings: warnings.length, brands: [...byBrand.keys()], figmaLinks: figmaLinks.length }), 'utf8');

    // Evidence attachments to Jira (idempotent by filename)
    if (writeBack && !dryRun && attachEvidence) {
      const existing = new Set((issue.fields?.attachment || []).map((a) => a.filename));
      const filesToUpload = [];

      // Per-issue markdown summary (small + ticket-specific)
      const issueMdName = `design-handoff.${key}.md`;
      const issueMdPath = path.join(outDir, issueMdName);
      fs.writeFileSync(
        issueMdPath,
        [
          `# Design handoff summary: ${key}`,
          '',
          `Jira: ${jiraLink}`,
          '',
          `## Warnings (${warnings.length})`,
          warnings.length ? warnings.map((w) => `- ${w}`).join('\n') : '- None',
          '',
          `## Figma links`,
          figmaLinks.map((f) => `- https://www.figma.com/design/${f.fileKey}?node-id=${f.nodeId.replace(':', '-')}`).join('\n'),
          '',
        ].join('\n'),
        'utf8'
      );

      if (!existing.has(issueMdName)) {
        filesToUpload.push({ filename: issueMdName, mimeType: 'text/markdown', buffer: fs.readFileSync(issueMdPath) });
      }
      if (!existing.has(svgName)) {
        filesToUpload.push({ filename: svgName, mimeType: 'image/svg+xml', buffer: fs.readFileSync(path.join(outDir, svgName)) });
      }

      // Upload in one request (Jira supports multiple files per call)
      if (filesToUpload.length) {
        await jiraAddAttachments(key, filesToUpload);
      }
    }
  }

  const totals = {
    issues: issues.length,
    warnings: [...warningsCountByIssue.values()].reduce((a, b) => a + b, 0),
  };
  const summarySvg = 'design-handoff.summary.svg';
  fs.writeFileSync(path.join(outDir, summarySvg), buildSummarySvg(totals), 'utf8');

  if (dryRun && dryRunComments.length > 0) {
    const commentsPath = path.join(outDir, 'jira-comments.txt');
    const commentsContent = dryRunComments
      .map(({ key, text }) => `========== ${key} ==========\n\n${text.trim()}\n`)
      .join('\n');
    fs.writeFileSync(commentsPath, commentsContent, 'utf8');
  }

  if (dryRun && dryRunResults.length > 0) {
    const resultsPath = path.join(outDir, 'dry-run-results-and-mismatches.txt');
    const lines = [
      'Design handoff dry-run – results and mismatches per ticket',
      'Generated: ' + new Date().toISOString(),
      '',
      '================================================================================',
      '',
    ];
    for (const r of dryRunResults) {
      lines.push(`========== ${r.key} ==========`);
      lines.push(`Summary: ${r.summary || '(none)'}`);
      lines.push('');
      if (r.noFigmaLink) {
        lines.push('Figma link: none');
        lines.push('Mismatches: N/A (no Figma link)');
        lines.push('Warnings: N/A');
      } else {
        lines.push('Figma link(s):');
        for (const url of r.figmaLinks || []) lines.push(`  - ${url}`);
        lines.push('');
        lines.push('Extracted variant properties (Figma):');
        if (Object.keys(r.extractedProps || {}).length === 0) {
          lines.push('  (none detected)');
        } else {
          for (const [prop, vals] of Object.entries(r.extractedProps || {})) {
            lines.push(`  ${prop}: ${vals.join(', ')}`);
          }
        }
        lines.push('');
        lines.push('MISMATCHES – Values in Figma not mentioned in Acceptance Criteria:');
        lines.push((r.figmaMissingInAc?.length ? r.figmaMissingInAc.join(', ') : 'None') || 'None');
        lines.push('');
        lines.push('MISMATCHES – Values mentioned in AC but not found in Figma:');
        lines.push((r.acMissingInFigma?.length ? r.acMissingInFigma.join(', ') : 'None') || 'None');
        lines.push('');
        lines.push('Accessibility – missing in AC (heuristic):');
        lines.push((r.a11yMissing?.length ? r.a11yMissing.join(', ') : 'None') || 'None');
        lines.push('');
        lines.push('Warnings:');
        if (r.warnings?.length) for (const w of r.warnings) lines.push(`  - ${w}`);
        else lines.push('  (none)');
      }
      lines.push('');
      lines.push('--------------------------------------------------------------------------------');
      lines.push('');
    }
    fs.writeFileSync(resultsPath, lines.join('\n'), 'utf8');
    const htmlPath = path.join(outDir, 'design-handoff-report.html');
    const jiraBaseUrl = process.env.JIRA_BASE_URL ? process.env.JIRA_BASE_URL.replace(/\/+$/, '') : 'https://tailored-prod.atlassian.net';
    fs.writeFileSync(htmlPath, buildHandoffHtml(dryRunResults, { jiraBaseUrl }), 'utf8');
  }

  writeReport({
    outFile: path.join(outDir, 'design-handoff.md'),
    title: 'Figma ↔ Jira design handoff report',
    sections: [
      {
        title: 'Summary',
        body: [
          ...(epicKey ? [`- Epic: ${epicKey} (${issues.length} child issues)`] : []),
          `- Issues processed: ${issues.length}`,
          `- Mode: ${epicKey ? `Epic ${epicKey}` : issueKeys?.length ? `issue(s): ${issueKeys.join(', ')}` : 'JQL search'}`,
          `- Write-back (Jira comment/checklist): ${writeBack && !dryRun ? 'enabled' : 'disabled (dry-run or WRITE_BACK=false)'}`,
        ].join('\n'),
      },
      {
        title: 'Snapshot',
        body: `![Run summary](${summarySvg})`,
      },
      {
        title: 'Results',
        body: [
          '| issue | figma (brand:file:node) | extracted | warnings | checklist inserted |',
          '|---|---|---:|---:|---|',
          ...reportRows,
        ].join('\n'),
      },
      {
        title: 'Notes',
        body: [
          '- Multi-link conflict detection is best-effort; prefer one canonical Figma node per ticket (or per brand).',
          '- Accessibility checks are heuristic and should be treated as “missing requirements prompts”, not definitive compliance.',
        ].join('\n'),
      },
    ],
  });
}

function buildSummarySvg({ issues, warnings }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220" viewBox="0 0 900 220">
  <defs>
    <style>
      .bg{fill:#0b1020}
      .card{fill:#121a33;stroke:#2a3a6a;stroke-width:2;rx:16;ry:16}
      .h{fill:#e8eeff;font:700 18px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
      .t{fill:#c6d2ff;font:600 14px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
      .barBg{fill:#1a2550}
      .bar{fill:#6f8bff}
    </style>
  </defs>
  <rect class="bg" x="0" y="0" width="900" height="220"/>
  <rect class="card" x="20" y="18" width="860" height="184" rx="16" ry="16"/>
  <text class="h" x="44" y="56">Design handoff run summary</text>
  <text class="t" x="44" y="90">Issues processed: ${issues}</text>
  <text class="t" x="44" y="116">Warnings found: ${warnings}</text>
  <rect class="barBg" x="44" y="140" width="560" height="18" rx="9" ry="9"/>
  <rect class="bar" x="44" y="140" width="${issues ? Math.round((560 * Math.min(warnings, issues)) / issues) : 0}" height="18" rx="9" ry="9"/>
  <text class="t" x="616" y="154">warnings density</text>
</svg>`;
}

function buildHandoffSvg({ key, warnings, brands, figmaLinks }) {
  const brandText = brands.length ? brands.join(', ') : 'unknown';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220" viewBox="0 0 900 220">
  <defs>
    <style>
      .bg{fill:#0b1020}
      .card{fill:#121a33;stroke:#2a3a6a;stroke-width:2;rx:16;ry:16}
      .h{fill:#e8eeff;font:700 18px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
      .t{fill:#c6d2ff;font:600 14px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
      .warn{fill:#ffcc66;font:800 14px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
    </style>
  </defs>
  <rect class="bg" x="0" y="0" width="900" height="220"/>
  <rect class="card" x="20" y="18" width="860" height="184" rx="16" ry="16"/>
  <text class="h" x="44" y="56">${key} handoff snapshot</text>
  <text class="t" x="44" y="94">Figma links: ${figmaLinks}</text>
  <text class="t" x="44" y="120">Brands: ${brandText}</text>
  <text class="warn" x="44" y="152">Warnings: ${warnings}</text>
</svg>`;
}

