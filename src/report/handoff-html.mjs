/**
 * Builds a single HTML file for visual design handoff report.
 * Tickets: { key, summary, figmaLinks?, extractedProps?, figmaMissingInAc?, acMissingInFigma?, a11yMissing?, warnings?, noFigmaLink? }
 */
function figmaEmbedUrl(designUrl) {
  if (!designUrl || !designUrl.includes('figma.com')) return '';
  return 'https://www.figma.com/embed?embed_host=share&url=' + encodeURIComponent(designUrl);
}

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildHandoffHtml(tickets, { jiraBaseUrl = 'https://tailored-prod.atlassian.net' } = {}) {
  const generated = new Date().toISOString();
  let cardsHtml = '';
  for (const t of tickets) {
    const figmaLinks = t.figmaLinks || [];
    const noFigma = t.noFigmaLink || figmaLinks.length === 0;
    const figmaEmbed = noFigma ? '' : figmaEmbedUrl(figmaLinks[0]);
    const openInFigma = !noFigma && figmaLinks[0] ? `<a href="${escapeHtml(figmaLinks[0])}" target="_blank" rel="noopener" class="figma-link">Open in Figma ↗</a>` : '';
    const jiraLink = `${jiraBaseUrl}/browse/${t.key}`;
    const snapshotSvg = `handoff.${t.key}.svg`;
    const extractedProps = t.extractedProps || {};
    const figmaMissingInAc = t.figmaMissingInAc || [];
    const acMissingInFigma = t.acMissingInFigma || [];
    const a11yMissing = t.a11yMissing || [];
    const warnings = t.warnings || [];
    const hasMismatches = figmaMissingInAc.length > 0 || acMissingInFigma.length > 0;
    const propsHtml = Object.entries(extractedProps).map(([k, vals]) =>
      `<div class="prop-row"><span class="prop-name">${escapeHtml(k)}</span><span class="prop-vals">${(vals || []).map((v) => `<span class="tag prop-val">${escapeHtml(v)}</span>`).join(' ')}</span></div>`
    ).join('');
    const figmaOnlyTags = figmaMissingInAc.map((v) => `<span class="tag missing-in-ac" title="In Figma, not in AC">${escapeHtml(v)}</span>`).join('');
    const acOnlyTags = acMissingInFigma.map((v) => `<span class="tag missing-in-figma" title="In AC, not in Figma">${escapeHtml(v)}</span>`).join('');
    const a11yTags = a11yMissing.map((v) => `<span class="tag a11y-missing">${escapeHtml(v)}</span>`).join('');
    const warnList = warnings.length ? `<ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : '<p class="none">None</p>';

    cardsHtml += `
    <section class="ticket-card" id="${escapeHtml(t.key)}">
      <header class="card-header">
        <h2><a href="${jiraLink}" target="_blank" rel="noopener">${escapeHtml(t.key)}</a> – ${escapeHtml(t.summary || '')}</h2>
        ${openInFigma}
      </header>
      <div class="card-body">
        <div class="figma-embed-wrap">
          <p class="embed-label">Design in Figma</p>
          ${figmaEmbed ? `<iframe class="figma-embed" src="${escapeHtml(figmaEmbed)}" allowfullscreen></iframe>` : '<p class="no-figma">No Figma link</p>'}
        </div>
        <div class="snapshot-wrap">
          <p class="embed-label">Handoff snapshot</p>
          <img src="${escapeHtml(snapshotSvg)}" alt="${escapeHtml(t.key)} snapshot" class="handoff-svg" loading="lazy" onerror="this.style.display='none'"/>
        </div>
        <div class="details-grid">
          <div class="detail-panel extracted">
            <h3>Extracted variant properties (Figma)</h3>
            ${propsHtml ? `<div class="props-list">${propsHtml}</div>` : '<p class="none">(none detected)</p>'}
          </div>
          <div class="detail-panel mismatches ${hasMismatches ? 'has-mismatches' : ''}">
            <h3>Mismatches</h3>
            <div class="mismatch-row">
              <div class="mismatch-col in-figma-only">
                <p class="mismatch-label">In Figma, not in AC</p>
                <div class="tag-list">${figmaOnlyTags || '<span class="none">None</span>'}</div>
              </div>
              <div class="mismatch-col in-ac-only">
                <p class="mismatch-label">In AC, not in Figma</p>
                <div class="tag-list">${acOnlyTags || '<span class="none">None</span>'}</div>
              </div>
            </div>
          </div>
          <div class="detail-panel a11y">
            <h3>Accessibility – missing in AC</h3>
            <div class="tag-list">${a11yTags || '<span class="none">None</span>'}</div>
          </div>
          <div class="detail-panel warnings">
            <h3>Warnings</h3>
            ${warnList}
          </div>
        </div>
      </div>
    </section>`;
  }

  const navLinks = tickets.map((t) => `<a href="#${escapeHtml(t.key)}">${escapeHtml(t.key)}</a>`).join('\n          ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Design handoff report – ${tickets.length} tickets</title>
  <style>
    :root {
      --bg: #0f1419;
      --card: #1a2332;
      --border: #2d3a4f;
      --text: #e6edf3;
      --text-muted: #8b9cb3;
      --accent: #58a6ff;
      --figma-green: #0acf83;
      --missing-ac: #f85149;
      --missing-figma: #d29922;
      --a11y: #a371f7;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 1rem;
    }
    .page-header {
      max-width: 1400px;
      margin: 0 auto 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }
    .page-header h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
    .page-header .meta { color: var(--text-muted); font-size: 0.9rem; }
    .nav-tickets {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.75rem;
    }
    .nav-tickets a {
      color: var(--accent);
      text-decoration: none;
      padding: 0.25rem 0.5rem;
      border-radius: 6px;
      background: var(--card);
      border: 1px solid var(--border);
      font-size: 0.85rem;
    }
    .nav-tickets a:hover { background: var(--border); }
    .ticket-card {
      max-width: 1400px;
      margin: 0 auto 2.5rem;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding: 1rem 1.25rem;
      background: rgba(0,0,0,0.2);
      border-bottom: 1px solid var(--border);
    }
    .card-header h2 { margin: 0; font-size: 1.1rem; font-weight: 600; }
    .card-header a { color: var(--accent); text-decoration: none; }
    .card-header a:hover { text-decoration: underline; }
    .figma-link {
      color: var(--figma-green) !important;
      font-size: 0.9rem;
    }
    .card-body { padding: 1.25rem; }
    .embed-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 0 0 0.5rem; }
    .figma-embed-wrap, .snapshot-wrap { margin-bottom: 1.25rem; }
    .figma-embed {
      width: 100%;
      height: 400px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #1e1e1e;
    }
    .handoff-svg { max-width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--border); }
    .no-figma { color: var(--text-muted); padding: 1rem; }
    .details-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1rem;
    }
    .detail-panel {
      background: rgba(0,0,0,0.15);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
    }
    .detail-panel h3 { margin: 0 0 0.5rem; font-size: 0.9rem; color: var(--text-muted); }
    .props-list .prop-row { margin-bottom: 0.35rem; font-size: 0.9rem; }
    .prop-name { color: var(--text-muted); margin-right: 0.5rem; }
    .tag {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.8rem;
      margin: 0.15rem 0.15rem 0 0;
    }
    .prop-val { background: #238636; color: #fff; }
    .missing-in-ac { background: var(--missing-ac); color: #fff; }
    .missing-in-figma { background: var(--missing-figma); color: #000; }
    .a11y-missing { background: var(--a11y); color: #fff; }
    .tag-list .none { color: var(--text-muted); font-size: 0.9rem; }
    .mismatch-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .mismatch-col .mismatch-label { font-size: 0.8rem; color: var(--text-muted); margin: 0 0 0.35rem; }
    .detail-panel.mismatches.has-mismatches { border-color: var(--missing-figma); }
    .detail-panel ul { margin: 0; padding-left: 1.25rem; font-size: 0.9rem; }
    .detail-panel .none { color: var(--text-muted); margin: 0; font-size: 0.9rem; }
    @media (max-width: 640px) { .mismatch-row { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header class="page-header">
    <h1>Design handoff report</h1>
    <p class="meta">Generated: ${escapeHtml(generated)} · ${tickets.length} tickets · Dry run (no Jira writes)</p>
    <nav class="nav-tickets" aria-label="Jump to ticket">
      ${navLinks}
    </nav>
  </header>
  ${cardsHtml}
</body>
</html>`;
}
