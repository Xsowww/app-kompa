// Apply the last theme before the first paint (no white flash in dark mode).
// A file rather than inline code, so the Content-Security-Policy can forbid inline scripts.
try {
  var t = localStorage.getItem('cop-theme');
  if (t === 'sombre' || ((!t || t === 'auto') && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.dataset.theme = 'dark';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#0c0d12');
  }
  // The look chosen in Profil › Apparence (glass, relief…): store/settings applyAppearance.
  var st = localStorage.getItem('cop-style');
  if (st === 'verre' || st === 'liquide' || st === 'relief') document.documentElement.dataset.style = st;
} catch (e) {}
