#!/usr/bin/env node
/**
 * Reads reports/dry-run-results-and-mismatches.txt and generates
 * reports/design-handoff-report.html for visual viewing in browser.
 * Includes Figma embeds and visual mismatch display.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildHandoffHtml } from '../src/report/handoff-html.mjs';

const REPORTS_DIR = path.resolve(process.cwd(), 'reports');
const INPUT_FILE = path.join(REPORTS_DIR, 'dry-run-results-and-mismatches.txt');
const OUTPUT_FILE = path.join(REPORTS_DIR, 'design-handoff-report.html');

function parseTicketBlocks(text) {
  const blocks = text.split(/\n========== /).filter(Boolean);
  const tickets = [];
  for (const block of blocks) {
    const keyMatch = block.match(/^([A-Z]+-\d+)\s*={10,}\s*\n/);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    const rest = block.slice(keyMatch[0].length).trim();
    const summaryMatch = rest.match(/^Summary:\s*(.+?)(?=\n\n|\nFigma)/s);
    const summary = summaryMatch ? summaryMatch[1].trim() : '';
    const figmaSection = rest.match(/Figma link\(s\):\s*\n((?:\s+-\s+.+\n?)*)/);
    const figmaLinks = figmaSection
      ? figmaSection[1].split('\n').map((l) => l.replace(/^\s+-\s+/, '').trim()).filter(Boolean)
      : [];
    const extractedMatch = rest.match(/Extracted variant properties \(Figma\):\s*\n((?:(?:\s+.+|\s+\(none detected\))\n?)*?)(?=\n\nMISMATCHES|$)/s);
    const extractedText = extractedMatch ? extractedMatch[1].trim() : '';
    const extractedProps = {};
    if (extractedText && !extractedText.includes('(none detected)')) {
      for (const line of extractedText.split('\n')) {
        const m = line.match(/^\s*([^:]+):\s*(.+)$/);
        if (m) extractedProps[m[1].trim()] = m[2].split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    const figmaOnlyMatch = rest.match(/MISMATCHES – Values in Figma not mentioned in Acceptance Criteria:\s*\n([^\n]+)/);
    const figmaMissingInAc = figmaOnlyMatch
      ? figmaOnlyMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const acOnlyMatch = rest.match(/MISMATCHES – Values mentioned in AC but not found in Figma:\s*\n([^\n]+)/);
    const acMissingInFigma = acOnlyMatch
      ? acOnlyMatch[1].split(',').map((s) => s.trim()).filter(Boolean).filter((s) => s !== 'None')
      : [];
    const a11yMatch = rest.match(/Accessibility – missing in AC \(heuristic\):\s*\n([^\n]+)/);
    const a11yMissing = a11yMatch
      ? a11yMatch[1].split(',').map((s) => s.trim()).filter(Boolean).filter((s) => s !== 'None')
      : [];
    const warnSection = rest.match(/Warnings:\s*\n((?:\s+-\s+.+|\s+\(none\)\n?)*)/);
    let warnings = [];
    if (warnSection) {
      const w = warnSection[1].trim();
      if (w && !w.startsWith('(none)')) warnings = w.split('\n').map((l) => l.replace(/^\s+-\s+/, '').trim()).filter(Boolean);
    }
    tickets.push({
      key,
      summary,
      figmaLinks,
      extractedProps,
      figmaMissingInAc,
      acMissingInFigma,
      a11yMissing,
      warnings,
    });
  }
  return tickets;
}

// (buildHtml moved to src/report/handoff-html.mjs)

function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error('Missing: ' + INPUT_FILE);
    process.exit(1);
  }
  const text = fs.readFileSync(INPUT_FILE, 'utf8');
  const tickets = parseTicketBlocks(text);
  if (tickets.length === 0) {
    console.error('No tickets parsed from ' + INPUT_FILE);
    process.exit(1);
  }
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const jiraBaseUrl = process.env.JIRA_BASE_URL ? process.env.JIRA_BASE_URL.replace(/\/+$/, '') : undefined;
  fs.writeFileSync(OUTPUT_FILE, buildHandoffHtml(tickets, jiraBaseUrl ? { jiraBaseUrl } : {}), 'utf8');
  console.log('Wrote ' + OUTPUT_FILE + ' (' + tickets.length + ' tickets)');
}

main();
