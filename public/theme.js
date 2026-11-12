// Apply the last theme before the first paint (no white flash in dark mode).
// A file rather than inline code, so the Content-Security-Policy can forbid inline scripts.
try {
  var t = localStorage.getItem('cop-theme');
  var dark = t === 'sombre' || ((!t || t === 'auto') && matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.dataset.theme = 'dark';
  // The look chosen in Réglages › Apparence (glass, relief…): store/settings applyAppearance (same page colours).
  var st = localStorage.getItem('cop-style');
  var paper = { verre: ['#e7eaf6', '#0b0d18'], liquide: ['#eceef2', '#111215'], relief: ['#e4e9f2', '#1e2126'] }[st] || ['#eceef3', '#0c0d12'];
  if (st === 'verre' || st === 'liquide' || st === 'relief') document.documentElement.dataset.style = st;
  // « Taille du texte » (Réglages › Apparence): the text at its size from the first paint (same as applyAppearance).
  var tx = localStorage.getItem('cop-text');
  if (tx === 'grand' || tx === 'tresgrand') document.documentElement.dataset.text = tx;
  // « Affichage Pro »: always dark, on Verre's glass, with its wallpaper (same as applyAppearance).
  var pro = localStorage.getItem('cop-pro');
  if (pro) {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.style = 'verre';
    document.documentElement.dataset.pro = pro;
    paper = ['#0c0d12', '#0c0d12'];
    // Its picture asked for now, first, rather than once the styles are read (themes.css › data-pro: « nuit » has
    // its own, the colour ones none, any other the mountain).
    var wall = pro === 'nuit' ? 'nuit' : /^(aurore|maree|braise)$/.test(pro) ? '' : 'montagne';
    if (wall) {
      var l = document.createElement('link');
      l.rel = 'preload';
      l.as = 'image';
      l.href = '/pro/' + wall + '.webp';
      l.setAttribute('fetchpriority', 'high');
      document.head.appendChild(l);
    }
  }
  document.querySelector('meta[name="theme-color"]').setAttribute('content', paper[dark ? 1 : 0]);
} catch (e) {}
