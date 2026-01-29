const LABEL_OK = 'design-handoff-ok';
const LABEL_WARN = 'design-handoff-warn';
const LABEL_MISSING_AC = 'design-handoff-missing-ac';

export function computeDesignHandoffLabels({ hasAc, warningsCount }) {
  if (!hasAc) return { primary: LABEL_MISSING_AC, all: [LABEL_MISSING_AC] };
  if (warningsCount > 0) return { primary: LABEL_WARN, all: [LABEL_WARN] };
  return { primary: LABEL_OK, all: [LABEL_OK] };
}

export function applyExclusiveDesignHandoffLabels(existingLabels, targetLabel) {
  const set = new Set(existingLabels || []);
  // Remove any previous labels from this automation family
  set.delete(LABEL_OK);
  set.delete(LABEL_WARN);
  set.delete(LABEL_MISSING_AC);
  set.add(targetLabel);
  return [...set].sort();
}


