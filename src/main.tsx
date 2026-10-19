import { loadLang } from './i18n';

// The language first: texts written at module level in the app are translated as soon as it loads.
void loadLang().then(() => import('./boot'));
