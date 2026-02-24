---
marp: true
theme: default
size: 16:9
paginate: true
style: |
  section { font-family: 'Segoe UI', system-ui, sans-serif; }
  h1 { color: #0d1117; }
  h2 { color: #238636; }
  strong { color: #0969da; }
  section.lead h1 { text-align: center; }
  section.lead p { text-align: center; }
---

<!-- _class: lead -->

# Figma ↔ Jira Design Handoff Automation

**Presenting the idea, implementation & process**

*TB Design Handoff System*

---

# Agenda

1. **The problem** – Why we need this
2. **The idea** – What is design handoff automation?
3. **How it works** – End-to-end flow
4. **Implementation** – Key components
5. **Process** – Variant extraction, AC comparison, mismatches
6. **Outputs & reports** – What you get
7. **Dry run & safety** – Preview without changing Jira
8. **Benefits & takeaways**
9. **Q&A**

---

# 1. The problem

- **Design** lives in **Figma** (components, states, variants).
- **Requirements** live in **Jira** (Acceptance Criteria, descriptions).
- They often **drift**: AC says “default, disabled, error” but Figma has “hover, focused” too—or the opposite.
- **Manual handoff** is slow and error-prone: someone has to compare Figma screens to Jira AC by hand.
- **QA and dev** need a single source of truth for “what states exist” and “what’s missing.”

---

# 2. The idea: Design handoff automation

**One tool that:**

1. Reads **Jira tickets** that contain **Figma links**.
2. Fetches the **Figma component/node** via the Figma API.
3. **Extracts** variant/state info from Figma (e.g. State=Default, State=Disabled).
4. **Compares** that to the **Acceptance Criteria** text in Jira.
5. **Flags mismatches**: in Figma but not in AC, or in AC but not in Figma.
6. **Optionally writes back** to Jira (comment, labels, checklist, attachments).
7. **Produces reports** (Markdown, text, HTML) for the team.

---

# 3. High-level flow

```
Jira issues (with Figma links)
        ↓
   Parse links → Fetch Figma nodes (API)
        ↓
   Extract variants from component names
        ↓
   Find "Acceptance Criteria" in Jira description
        ↓
   Compare: Figma values vs AC text → Mismatches
        ↓
   Accessibility heuristic check (keyboard, focus, ARIA, etc.)
        ↓
   Outputs: Reports (MD, TXT, HTML) + optional Jira comment, labels, attachments
```

---

# 4. Implementation – Entry & pipeline

**Entry point**
- `scripts/run.mjs` – CLI
- `--issue=RFW-496` or `--issue=RFW-496,RFW-497,...` or `--jql="project = RFW ..."`
- `--dry-run=true` – no Jira writes, only reports

**Pipeline** (`src/pipeline/design-handoff.mjs`)
- Resolves list of issues (by key or JQL).
- For each issue: get Jira issue → extract Figma URLs → fetch Figma nodes → extract variants → find AC → diff → a11y check → build comment → optionally write back.
- Writes all reports to `reports/`.

---

# 5. Implementation – Connectors

**Jira** (`src/connectors/jira.mjs`)
- Jira Cloud REST **v3** (search via `/rest/api/3/search/jql`).
- Auth: email + API token.
- Get issue, search JQL, add comment (ADF), update description, update labels, add attachments.

**Figma** (`src/connectors/figma.mjs`)
- Figma REST API: `GET /v1/files/:fileKey/nodes?ids=...`
- Auth: Figma personal access token.
- Returns node tree for the given node IDs (component sets, components).

---

# 6. Process – Variant extraction (Figma)

- Tool parses **component names** in Figma (not the variant properties API).
- **Supported pattern:** `PropertyName=Value` comma-separated  
  e.g. `State=Default, Checked=On`
- **Fallback:** names with `/` → single `_variant` (e.g. "Desktop / Mobile").
- Walks the node tree, collects every **Component** and **Component Set**, and merges all property names and values into a **summary** (e.g. `State: [Default, Disabled, Error, Hover]`).
- **Best practice:** name variants consistently in Figma (e.g. `State=Default`, `State=Disabled`).

---

# 7. Process – Acceptance Criteria & mismatches

**Finding AC**
- Look for a line like **"Acceptance Criteria"** (case-insensitive) in the Jira description.
- Take all following lines until the next header.

**Mismatch detection**
- **“In Figma, not in AC”**: Each value from Figma (e.g. default, hover) is checked: is it mentioned in the AC text? If not → listed as missing from AC.
- **“In AC, not in Figma”**: Tokenize AC; words that look like states (default, disabled, focus, etc.) but are not in the Figma value set → listed as missing from Figma.
- Result is **heuristic** (text-based); helps catch drift, not a formal spec check.

---

# 8. Process – Accessibility check

- **Heuristic** over AC (and description) text.
- Looks for keywords for:
  - **Keyboard** (keyboard, tab, space, enter)
  - **Focus** (focus, focus-visible, focus ring)
  - **ARIA** (aria, screen reader, aria-label)
  - **Error** (error message, validation, aria-invalid)
  - **Hit area** (44, hit area, tap target)
- If none of the keywords for a requirement appear → **missing** (listed in comment and reports).
- Use: **prompt** for authors to add a11y to AC; not a conformance test.

---

# 9. Jira write-back (when not dry run)

| Feature | What it does |
|--------|----------------|
| **Comment** | Posts an ADF comment: summary, Figma links, extracted props, discrepancies, a11y missing, warnings. |
| **Checklist** | If description doesn’t have the marker, appends “Design Handoff Checklist” (Figma link, states, responsive, a11y, QA notes). |
| **Labels** | Sets one of: `design-handoff-ok`, `design-handoff-warn`, `design-handoff-missing-ac`. |
| **Attachments** | Uploads `design-handoff.<KEY>.md` and `handoff.<KEY>.svg` (idempotent). |

Controlled by env: `WRITE_BACK`, `JIRA_LABEL_AUTOMATION`, `JIRA_ATTACH_EVIDENCE`.

---

# 10. Outputs & reports

**Every run**
- `reports/design-handoff.md` – Summary, mode, results table.
- `reports/design-handoff.summary.svg` – Summary image.
- `reports/handoff.<KEY>.svg` – Per-ticket snapshot.

**Dry run only**
- `reports/jira-comments.txt` – Would-be Jira comment (plain text) per ticket.
- `reports/dry-run-results-and-mismatches.txt` – Per-ticket: summary, Figma links, extracted props, **mismatches**, a11y, warnings.
- `reports/design-handoff-report.html` – **Visual report**: Figma embed, snapshot, colour-coded mismatches (red = in Figma not in AC, amber = in AC not in Figma). Open in browser.

---

# 11. Dry run – Safe preview

- **`--dry-run=true`** → **No Jira writes** (no comment, no description update, no labels, no attachments).
- Pipeline still runs fully: fetches Jira + Figma, extracts variants, computes mismatches and a11y.
- All local reports are still generated, including the HTML report and the “would-be” comments file.
- **Use case:** Preview what would be posted and review mismatches before enabling write-back.

---

# 12. Configuration (environment)

**Required**
- `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`
- `FIGMA_TOKEN`

**Optional**
- `CONFLUENCE_HANDOFF_PAGE_URL` – Linked in Jira comment.
- `FIGMA_BRAND_FILE_KEYS` – Multi-brand (e.g. tmw=fileKey, jab=fileKey).
- `WRITE_BACK`, `JIRA_LABEL_AUTOMATION`, `JIRA_ATTACH_EVIDENCE`
- `SLACK_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL` – Notifications when there are warnings.

---

# 13. Benefits & takeaways

- **Less drift** – Figma and Jira AC stay aligned; mismatches are visible early.
- **Faster handoff** – “What states exist?” is answered automatically from Figma.
- **Better QA** – Consistent, automated view of expected states.
- **Auditability** – Every run leaves a report and, with write-back, a Jira comment.
- **Scales** – Run for one ticket or many via JQL (e.g. whole sprint).
- **Safe** – Dry run lets you preview everything before writing to Jira.

---

# 14. How to run (recap)

- **Single ticket:**  
  `node ./scripts/run.mjs --issue=RFW-496`
- **Multiple tickets:**  
  `node ./scripts/run.mjs --issue=RFW-496,RFW-497,RFW-498`
- **By JQL:**  
  `node ./scripts/run.mjs --jql="project = RFW AND sprint = 11781"`
- **Dry run (no Jira writes):**  
  `node ./scripts/run.mjs --issue=RFW-496 --dry-run=true`

Set credentials in `.env` (see `config/example.env`).

---

<!-- _class: lead -->

# Figma ↔ Jira Design Handoff Automation

**Idea · Implementation · Process**

Questions?

---

# Appendix – Where to learn more

- **Repo:** `tb-design-handoff-automation`
- **Detailed system doc:** `docs/DESIGN-HANDOFF-SYSTEM.md`
- **README:** Setup, run, outputs, troubleshooting
- **HTML report:** Open `reports/design-handoff-report.html` in browser (after a dry run) for visual mismatches and Figma embeds.
