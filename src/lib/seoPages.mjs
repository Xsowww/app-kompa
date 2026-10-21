// The public pages as search engines first read them: title and description in the page's HTML.
// Plain JavaScript: the server (server/seo.mjs) fills them in with the app's translations (src/i18n).

/** The pages anyone can open (the others need an account). Same list as INDEXED in App.tsx. */
export const PUBLIC_PAGES = ['/', '/inscription', '/connexion', '/mentions-legales', '/confidentialite', '/conditions'];

/** @param {(fr: string) => string} t */
export const pageHeads = t => ({
  '/': {
    title: t('Kompaly · Agenda, notes, fichiers et tâches au même endroit'),
    description: t('Kompaly réunit ton agenda, tes tâches, tes notes et tes fichiers dans une seule appli gratuite, pour les études, le travail ou la vie perso.'),
  },
  '/inscription': {
    title: `${t('Inscription')} · Kompaly`,
    description: t('Crée ton compte Kompaly gratuit en une minute : agenda, tâches, notes et fichiers au même endroit.'),
  },
  '/connexion': {
    title: `${t('Connexion')} · Kompaly`,
    description: t('Connecte-toi à Kompaly pour retrouver ton agenda, tes tâches, tes notes et tes fichiers.'),
  },
  '/mentions-legales': { title: `${t('Mentions légales')} · Kompaly`, description: t('Mentions légales de Kompaly : éditeur, hébergement et contact.') },
  '/confidentialite': {
    title: `${t('Confidentialité')} · Kompaly`,
    description: t('Comment Kompaly protège tes données : ce qui est gardé, où, combien de temps, et tes droits.'),
  },
  '/conditions': { title: `${t('Conditions d’utilisation')} · Kompaly`, description: t('Les règles d’utilisation de Kompaly, l’appli gratuite pour s’organiser.') },
});
