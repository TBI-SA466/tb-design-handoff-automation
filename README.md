# tb-design-handoff-automation

Automates **Figma ↔ Jira “design handoff”**:

- When a Jira issue includes a Figma link, this tool:
  - Extracts **component states/variants** from the referenced Figma node
  - Compares them to **Acceptance Criteria** text in Jira (best-effort)
  - Flags discrepancies:
    - AC mentions states not present in Figma
    - Figma has states not mentioned in AC
  - Posts a **summary comment** back to the Jira ticket
  - Optionally includes a **Confluence handoff page link**

## What it does today (v1)

- Works with Jira Cloud REST v3
- Works with Figma REST API `/files/:key/nodes`
- Detects Figma variants by parsing **Component Set / Component names** (common “Variant=Value” patterns)
- Posts a Jira comment summarizing:
  - Figma links found
  - Extracted variant properties + values
  - “AC contains / missing” signals

## Setup

Copy `config/example.env` to `.env` and fill it:

```bash
cp config/example.env .env
```

## Run

Run for a single issue:

```bash
node ./scripts/run.mjs --issue=RFW-1234
```

Run for multiple issues via JQL:

```bash
node ./scripts/run.mjs --jql="project = RFW AND updated >= -7d order by updated DESC"
```

## Outputs

- Writes a markdown report to `reports/design-handoff.md`
- Posts a Jira comment to each processed issue

## GitHub Actions

Includes a workflow to run:
- manually (workflow_dispatch) with `issue` or `jql`
- scheduled (optional)


