# Design Handoff System – Detailed Description

This document describes the **Figma ↔ Jira design handoff automation**: what it does, how it works, and how each part fits together.

---

## 1. Overview and purpose

### What it is

The design handoff system is an automation tool that:

1. **Reads Jira tickets** that contain one or more Figma design links.
2. **Fetches the referenced Figma nodes** (components or component sets) via the Figma API.
3. **Extracts variant/state information** from Figma (e.g. “State=Default”, “State=Disabled”).
4. **Compares that information** to the **Acceptance Criteria (AC)** text in the Jira description.
5. **Detects mismatches**: states in Figma not mentioned in AC, and states mentioned in AC but not found in Figma.
6. **Optionally writes back to Jira**: summary comment, labels, checklist, and evidence attachments.
7. **Produces local reports** (Markdown, text, and HTML) for auditing and sharing.

### Why it exists

- **Reduce drift** between design (Figma) and requirements (Jira AC) before development and QA.
- **Speed up handoff** by surfacing “what states exist” in Figma without manual inspection.
- **Improve QA readiness** with a consistent, automated view of expected states.
- **Leave an audit trail**: every run produces a report and, when write-back is on, a Jira comment.

---

## 2. High-level flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Jira (issues)  │────▶│  Design handoff   │────▶│  Figma API      │
│  - Description  │     │  pipeline        │     │  /files/:id/    │
│  - Summary      │     │  - Parse links    │     │  nodes          │
│  - AC text      │     │  - Get nodes      │     └────────┬────────┘
└────────┬────────┘     │  - Extract vars   │              │
         │              │  - Compare AC     │              │
         │              │  - Diff states    │              ▼
         │              │  - A11y check     │     ┌─────────────────┐
         │              └────────┬──────────┘     │  Component Set  │
         │                       │                │  / Component   │
         │                       │                │  (variant names)│
         │                       ▼                └─────────────────┘
         │              ┌──────────────────┐
         │              │  Outputs         │
         │              │  - Report (MD)    │
         │              │  - Comments (TXT)│
         │              │  - HTML report   │
         │              │  - Jira comment │
         │              │  - Jira labels   │
         │              │  - Attachments   │
         │              └──────────────────┘
         └──────────────────────────────────────▶ (optional write-back)
```

1. **Input**: One or more Jira issue keys (e.g. `RFW-496`) or a JQL query (e.g. `project = RFW AND sprint = 11781`).
2. **Fetch issues**: For each issue, the tool loads the Jira issue (summary, description, labels, attachments).
3. **Find Figma links**: It scans the summary and description for URLs; any `https://www.figma.com/design/<fileKey>/...?node-id=...` is parsed to get `fileKey` and `node-id`.
4. **Fetch Figma nodes**: For each unique (fileKey, nodeId), it calls the Figma REST API `GET /v1/files/:fileKey/nodes?ids=...` to get the node tree.
5. **Extract variants**: From the node tree it collects **Component** and **Component Set** nodes and parses their **names** to build a variant property matrix (see below).
6. **Parse Acceptance Criteria**: It looks for a section in the Jira description that starts with “Acceptance Criteria”, “A/C”, “AC”, “a/c”, or “ac” (case-insensitive, optional colon) and takes the following lines until the next header.
7. **Compare and diff**: It compares the set of “values” from Figma (e.g. default, disabled, hover) with words/phrases in the AC text and produces two lists: *in Figma but not in AC* and *in AC but not in Figma*.
8. **Accessibility check**: It runs a heuristic over the AC (and description) to see if certain a11y topics are mentioned (keyboard, focus, ARIA, error messaging, hit area).
9. **Output**: It writes local reports and, unless in dry-run or `WRITE_BACK=false`, posts a Jira comment, optionally updates labels, optionally inserts a checklist, and optionally uploads evidence attachments.

---

## 3. Components and responsibilities

### 3.1 Entry point and CLI

- **`scripts/run.mjs`**
  - Parses CLI: `--issue=KEY`, `--issue=KEY1,KEY2,...`, `--epic=EPIC-KEY`, `--jql="..."`, and `--dry-run=true`.
  - **Epic mode** (`--epic=RFW-100`): resolves all child issue keys of the Epic via `jiraGetIssueKeysInEpic` (JQL from `EPIC_CHILD_JQL` or default `parent = {epicKey}`), then runs the pipeline on those issues. Report summary includes “Epic: RFW-100 (N child issues)”.
  - Ensures `reports/` exists and calls the pipeline with `outDir`, `issueKeys`/`jql`, `dryRun`, and optionally `epicKey`.

### 3.2 Pipeline

- **`src/pipeline/design-handoff.mjs`**
  - **`runDesignHandoff({ outDir, issueKeys, jql, dryRun })`**
  - Resolves the list of Jira issues (either by key or via JQL search).
  - For each issue: extracts Figma links, fetches Figma nodes, extracts variants, finds AC, diffs states, runs a11y check, builds the Jira comment (ADF), and optionally writes back.
  - Writes:
    - `design-handoff.md` (summary + table),
    - `design-handoff.summary.svg`,
    - per-issue `handoff.<KEY>.svg`,
    - (dry run) `jira-comments.txt`, `dry-run-results-and-mismatches.txt`, `design-handoff-report.html`.

- **Epic-level handoff**: Use `--epic=EPIC-KEY` to run design handoff on every issue that belongs to that Epic. Child issues are found via JQL (default: `parent = EPIC-KEY`; override with `EPIC_CHILD_JQL`, e.g. `"Epic Link" = {epicKey}` for classic boards). The same pipeline runs for each child; the report and dry-run outputs aggregate all of them and the summary shows the Epic key.

### 3.3 Connectors

- **`src/connectors/jira.mjs`**
  - **Jira Cloud REST v3** (base URL from `JIRA_BASE_URL`, auth: `JIRA_EMAIL` + `JIRA_API_TOKEN`).
  - `jiraGetIssue(key)` – get issue with fields: summary, description, status, labels, attachment.
  - `jiraSearchJql(jql, { maxResults })` – search using **`/rest/api/3/search/jql`** (current endpoint).
    - `jiraGetIssueKeysInEpic(epicKey)` – return issue keys of all issues in the Epic (JQL from `EPIC_CHILD_JQL` or default `parent = {epicKey}`).
  - `jiraAddCommentAdf(key, adf)` – add a comment in Atlassian Document Format (ADF).
  - `jiraUpdateIssueDescription(key, adf)` – set description (used for checklist insert).
  - `jiraUpdateIssueLabels(key, labels)` – set issue labels.
  - `jiraAddAttachments(key, files)` – upload files (e.g. markdown + SVG).

- **`src/connectors/figma.mjs`**
  - **Figma REST API** (`X-Figma-Token` from `FIGMA_TOKEN`).
  - `figmaGetNodes({ fileKey, nodeIds })` – `GET https://api.figma.com/v1/files/:fileKey/nodes?ids=...` to fetch one or more nodes (returns full node tree for each).

### 3.4 Libraries

- **`src/lib/links.mjs`**
  - `extractUrls(text)` – find all HTTP/HTTPS URLs in a string.
  - `parseFigmaDesignUrl(url)` – from a Figma design URL return `{ fileKey, nodeId }` (node-id query param is normalized to `id:id` for the API).

- **`src/lib/adf.mjs`**
  - `adfToPlainText(adf)` – walk ADF document and produce plain text (used for dry-run comment file and for reading Jira description).

- **`src/lib/a11y.mjs`**
  - `checkAccessibilityRequirements(acText)` – heuristic check for: keyboard, focus, ARIA, error messaging, hit area. Returns `{ present, missing }` (each item has `key` and `label`).

- **`src/lib/jira-labels.mjs`**
  - Labels: `design-handoff-ok`, `design-handoff-warn`, `design-handoff-missing-ac`.
  - `computeDesignHandoffLabels({ hasAc, warningsCount })` – choose one label.
  - `applyExclusiveDesignHandoffLabels(existingLabels, targetLabel)` – remove other handoff labels and set the chosen one.

- **`src/lib/jira-adf-build.mjs`**
  - Helpers to build ADF: `adfDoc`, `adfParagraph`, `adfHeading`, `adfBulletList`, `appendChecklistSection` (idempotent insert of a “Design Handoff Checklist” block if a marker is not already present).

- **`src/lib/brand.mjs`**
  - `parseBrandFileKeyMap(FIGMA_BRAND_FILE_KEYS)` – optional env e.g. `tmw=fileKey1,jab=fileKey2`.
  - `brandForFileKey(fileKey, brandMap)` – return brand name for a Figma file; used for multi-brand reporting.

- **`src/lib/notify.mjs`**
  - If `SLACK_WEBHOOK_URL` or `TEAMS_WEBHOOK_URL` is set, sends a notification when there are warnings (title, text, link to Jira).

### 3.5 Reports

- **`src/report/markdown.mjs`** – builds `design-handoff.md` from sections (summary, snapshot, results table, notes).
- **`src/report/handoff-html.mjs`** – `buildHandoffHtml(tickets, { jiraBaseUrl })` builds the single-file HTML report with Figma embeds, handoff snapshots, and colour-coded mismatches.
- **`scripts/generate-handoff-html.mjs`** – reads `reports/dry-run-results-and-mismatches.txt`, parses it into ticket objects, and calls `buildHandoffHtml` to regenerate `reports/design-handoff-report.html` without re-running the pipeline.

---

## 4. Variant extraction (Figma)

- The tool uses **component names** in Figma to infer variant properties. It does **not** use Figma’s native variant properties API; it parses the **name** string.
- Supported pattern: **`PropertyName=Value`** comma-separated, e.g. `State=Default, Checked=On`.
- Fallback: if no `key=value` pairs are found, it splits the name by `/` and stores a single `_variant` property (e.g. `"Desktop / Mobile"`).
- It walks the node tree and collects every **COMPONENT** and **COMPONENT_SET**; for each it parses the name and merges all unique property names and values into a **summary** (e.g. `State: [Default, Disabled, Error, Hover]`).
- So: **“what exactly is in Figma”** is derived from **component/variant names** in the file. If designers use consistent naming (e.g. `State=Default`), extraction works well; otherwise the tool may see “(none detected)” or only `_variant`.

---

## 5. Acceptance Criteria and mismatch detection

- **Finding AC**: The pipeline looks for a line that matches any of: “Acceptance Criteria” (case-insensitive), “A/C”, “AC”, “a/c”, “ac” (with optional colon), and then takes all following lines until the next “header” (line starting with `#` or a pattern like `Word: `). That block is treated as the AC text.
- **Diff logic** (`diffStates`):
  - All values from the Figma summary (e.g. default, disabled, hover) are lowercased and collected.
  - Each such value is checked: is it **mentioned** in the AC text (substring match, case-insensitive)? If yes, it’s “mentioned”; if not, it goes into **“Values in Figma not mentioned in AC”**.
  - The AC text is tokenized (words ≥3 chars). Words that look “state-like” (e.g. default, disabled, error, hover, focus, loading, active, or containing “state”) and are **not** in the Figma value set go into **“Values mentioned in AC but not found in Figma”**.
- So:
  - **In Figma, not in AC** = design has states/variants that the written AC doesn’t mention.
  - **In AC, not in Figma** = AC mentions states that weren’t found in the parsed Figma names.

This is **heuristic** and text-based; it does not understand full sentences or intent.

---

## 6. Accessibility checks

- **`checkAccessibilityRequirements(acText)`** looks for the presence of certain keywords in the AC (or description) text:
  - **keyboard** – e.g. keyboard, tab, shift+tab, space, enter.
  - **focus** – focus, focus-visible, focus ring, focus outline.
  - **aria** – aria, screen reader, sr-only, accessible name, aria-label, aria-describedby.
  - **error** – error message, validation, aria-invalid, helper text.
  - **hitarea** – 44, hit area, tap target, touch target.
- For each requirement, if **none** of its keywords appear, it’s added to **missing**. The Jira comment and reports then list “Missing: keyboard, hitarea” etc.
- This is a **prompt for authors** to consider adding a11y to AC; it is not a conformance or testing tool.

---

## 7. Jira write-back (when not dry run)

When **`WRITE_BACK`** is true and **`dryRun`** is false:

1. **Comment**  
   A structured ADF comment is posted with:
   - Design handoff automation summary
   - Jira key and summary
   - Figma links (up to 5)
   - Optional Confluence handoff link
   - Extracted variant properties
   - Discrepancies (Figma vs AC)
   - Accessibility checks (missing list)
   - Warnings
   - Bot marker `<!-- design-handoff-bot -->`

2. **Checklist**  
   If the issue description does **not** already contain the marker `<!-- design-handoff-checklist -->`, the tool appends a “Design Handoff Checklist” section (with that marker) to the description. Checklist items are fixed (Figma link, states/variants, responsive, accessibility, QA notes).

3. **Labels**  
   If **`JIRA_LABEL_AUTOMATION`** is true, it sets exactly one of:
   - `design-handoff-missing-ac` – no AC section found
   - `design-handoff-warn` – AC found but there are warnings
   - `design-handoff-ok` – AC found and no warnings  
   Other handoff labels are removed so the ticket has only one of these.

4. **Attachments**  
   If **`JIRA_ATTACH_EVIDENCE`** is true, it uploads (only if not already attached):
   - `design-handoff.<KEY>.md` – short markdown summary for the ticket
   - `handoff.<KEY>.svg` – handoff snapshot SVG  
   Upload is idempotent (checks existing attachment filenames).

---

## 8. Reports and outputs

| Output | When | Description |
|--------|------|-------------|
| `reports/design-handoff.md` | Every run | Markdown report: generated time, mode, write-back status, summary SVG, results table (issue, figma node, props count, warnings, checklist inserted), notes. |
| `reports/design-handoff.summary.svg` | Every run | Summary image (e.g. issues count, total warnings). |
| `reports/handoff.<KEY>.svg` | Per issue with Figma | Small card per ticket (Figma links count, brands, warnings). |
| `reports/jira-comments.txt` | Dry run only | Plain-text version of the comment that **would** have been posted for each ticket. |
| `reports/dry-run-results-and-mismatches.txt` | Dry run only | Per-ticket: summary, Figma links, extracted props, **mismatches** (Figma not in AC, AC not in Figma), a11y missing, warnings. |
| `reports/design-handoff-report.html` | Dry run only (and via script) | Single HTML file: per-ticket cards with Figma embed iframe, handoff snapshot image, extracted props, **visual mismatch tags** (red = in Figma not in AC, amber = in AC not in Figma), a11y tags, warnings. Open in browser from `reports/` or via a local server for Figma iframes. |

---

## 9. Dry run mode

- **`--dry-run=true`** (or `dryRun: true` in the API):
  - No Jira writes: no comment, no description update, no labels, no attachments.
  - Pipeline still runs fully: fetches Jira and Figma, extracts variants, computes diffs and a11y.
  - All local reports are written, including:
    - `design-handoff.md`
    - `jira-comments.txt` (would-be comments)
    - `dry-run-results-and-mismatches.txt` (full per-ticket results and mismatches)
    - `design-handoff-report.html` (visual report with images and Figma embeds).

Use dry run to **preview** what would be posted and to **inspect mismatches** without changing Jira.

---

## 10. Configuration (environment)

- **Required**: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `FIGMA_TOKEN`.
- **Optional**:
  - `CONFLUENCE_HANDOFF_PAGE_URL` – linked in the Jira comment.
  - `FIGMA_BRAND_FILE_KEYS` – e.g. `tmw=xxx,jab=yyy` for multi-brand labels in the report.
  - `WRITE_BACK` – `true`/`false`; if false, no Jira modifications (similar to dry run for writes only).
  - `JIRA_LABEL_AUTOMATION`, `JIRA_ATTACH_EVIDENCE` – enable/disable labels and evidence attachments.
  - `SLACK_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL` – notifications when warnings exist.

---

## 11. Limitations and best practices

- **Variant extraction** depends on Figma **naming**. Use consistent patterns (e.g. `State=Default`, `State=Disabled`) for best results.
- **AC parsing** is line-based and header-based; use a clear section header (“Acceptance Criteria”, “A/C”, “AC”, “a/c”, or “ac”) and list states/requirements in a way that matches the heuristic (e.g. words like “default”, “disabled”, “focus”).
- **Mismatch detection** is textual and heuristic; it can produce false positives/negatives (e.g. “focus” in a sentence vs. “Focus” as a variant name).
- The tool **does not** modify the AC text itself; it only posts a comment and optional checklist/labels/attachments.
- For **Figma embeds** in the HTML report to work, the report should be opened via HTTP (e.g. `npx serve reports -p 3333`); `file://` may block iframes.
- **Jira search** uses the `/rest/api/3/search/jql` endpoint (required after Atlassian’s deprecation of the old search endpoint).

---

## 12. Summary

The design handoff system automates the comparison between **what’s in Figma** (derived from component/variant names) and **what’s written in Jira Acceptance Criteria**. It produces **mismatches** (in Figma not in AC, in AC not in Figma), **accessibility prompts**, and **optional Jira write-back** (comment, checklist, labels, attachments). All runs produce **local reports**; dry run adds **text and HTML** reports so you can see exactly what would be posted and inspect mismatches in a **visual format** in the browser.
