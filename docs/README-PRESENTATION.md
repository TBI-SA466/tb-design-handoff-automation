# Design handoff – Presentation

## Downloadable PowerPoint

- **File:** [design-handoff-presentation.pptx](design-handoff-presentation.pptx)  
  Open or download this file to present the design handoff system (idea, implementation, process) to your team.

## Slides source

- **Markdown (source):** [design-handoff-presentation.md](design-handoff-presentation.md)  
  Editable slide deck in Marp format. You can change content and re-export to PPTX.

## Regenerate PPTX

From the project root:

```bash
npm run slides:export
```

Or:

```bash
npx @marp-team/marp-cli@latest docs/design-handoff-presentation.md --pptx -o docs/design-handoff-presentation.pptx --no-stdin
```

Requires Node.js and (for Marp) Chrome/Edge/Firefox installed.

## Slide overview

1. Title  
2. Agenda  
3. The problem  
4. The idea: design handoff automation  
5. High-level flow  
6. Implementation – entry & pipeline  
7. Implementation – connectors (Jira, Figma)  
8. Process – variant extraction (Figma)  
9. Process – Acceptance Criteria & mismatches  
10. Process – accessibility check  
11. Jira write-back  
12. Outputs & reports  
13. Dry run – safe preview  
14. Configuration  
15. Benefits & takeaways  
16. How to run (recap)  
17. Q&A  
18. Appendix – where to learn more  
