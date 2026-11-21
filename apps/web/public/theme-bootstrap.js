// Runs synchronously in head, before CSS and React. Only local appearance is read.
(function () {
  var preference = 'system';
  try { var value = localStorage.getItem('study-workbench.appearance.v1'); if (value === 'light' || value === 'dark' || value === 'system') preference = value; } catch (_) {}
  var dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = preference === 'system' ? (dark ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
