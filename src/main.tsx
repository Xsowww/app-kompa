import { loadLang } from './i18n';
import { guestHome } from './lib/guestHome.mjs';

// The language first: texts written at module level in the app are translated as soon as it loads.
// A visitor on « / » gets the home page alone (landing.tsx), the app comes with the first link they follow.
void loadLang().then(() => {
  if (guestHome()) void import('./landing');
  else void import('./boot').then(m => m.start());
});
