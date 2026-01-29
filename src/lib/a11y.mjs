export function checkAccessibilityRequirements(acText) {
  const t = (acText || '').toLowerCase();

  const requirements = [
    { key: 'keyboard', label: 'Keyboard navigation (Tab/Shift+Tab, Space/Enter)', any: ['keyboard', 'tab', 'shift+tab', 'space', 'enter'] },
    { key: 'focus', label: 'Focus state (focus ring / focus visible)', any: ['focus', 'focus-visible', 'focus ring', 'focus outline'] },
    { key: 'aria', label: 'ARIA / screen reader support', any: ['aria', 'screen reader', 'sr-only', 'accessible name', 'aria-label', 'aria-describedby'] },
    { key: 'error', label: 'Error messaging behavior', any: ['error message', 'validation', 'aria-invalid', 'helper text'] },
    { key: 'hitarea', label: 'Hit area / tap target (44×44)', any: ['44', 'hit area', 'tap target', 'touch target'] },
  ];

  const present = [];
  const missing = [];
  for (const r of requirements) {
    const ok = r.any.some((k) => t.includes(k));
    if (ok) present.push(r);
    else missing.push(r);
  }

  return { present, missing };
}


