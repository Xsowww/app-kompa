// Apply the last theme before the first paint (no white flash in dark mode).
// A file rather than inline code, so the Content-Security-Policy can forbid inline scripts.
try {
  var t = localStorage.getItem('cop-theme');
  var dark = t === 'sombre' || ((!t || t === 'auto') && matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.dataset.theme = 'dark';
  // The look chosen in Profil › Apparence (glass, relief…): store/settings applyAppearance (same page colours).
  var st = localStorage.getItem('cop-style');
  var paper = { verre: ['#e7eaf6', '#0b0d18'], liquide: ['#eceef2', '#111215'], relief: ['#e4e9f2', '#1e2126'] }[st] || ['#eceef3', '#0c0d12'];
  if (st === 'verre' || st === 'liquide' || st === 'relief') document.documentElement.dataset.style = st;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', paper[dark ? 1 : 0]);
} catch (e) {}
