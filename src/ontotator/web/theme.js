/*
 * Applies the theme chosen on Profile before the first paint, so the page never flashes in the other theme.
 * A file of its own because the Content-Security-Policy allows no inline script. Keep the key and the values
 * in step with src/ui/theme.ts (tests/theme.test.tsx runs this file). Nothing stored means "System": the
 * stylesheet then follows prefers-color-scheme.
 */
(function () {
  try {
    var choice = window.localStorage.getItem("ontotator.theme.v1");
    if (choice === "light" || choice === "dark") document.documentElement.setAttribute("data-theme", choice);
  } catch (_error) {
    // Storage is blocked: the system setting applies.
  }
})();
