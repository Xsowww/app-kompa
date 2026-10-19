import { Link, NavLink } from 'react-router-dom';
import Logo from '../../components/Logo';
import { LEGAL_LINKS } from './links';
import { lang, locale, t } from '../../i18n';

// Pages légales, lisibles sans compte. Les sous-traitants cités ici doivent rester à jour (registre des traitements).

export type LegalDoc = 'mentions' | 'confidentialite' | 'conditions';

const UPDATED = new Date(2026, 9, 19).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
const CONTACT = 'contact@kompaly.com';

type Section = { title: string; body: string[] };

const DOCS: Record<LegalDoc, { title: string; sections: Section[] }> = {
  mentions: {
    title: t('Mentions légales'),
    sections: [
      {
        title: t('Éditeur du site'),
        body: [
          t('Kompaly est édité par Léo Boucher, particulier, à titre non professionnel.'),
          t('Comme le permet l’article 6, III, 2 de la loi pour la confiance dans l’économie numérique (LCEN), l’adresse de l’éditeur n’est pas publiée : son identité est connue de l’hébergeur. Contact : {email}.', { email: CONTACT }),
          t('Directeur de la publication : Léo Boucher.'),
        ],
      },
      {
        title: t('Hébergement'),
        body: [
          t('Site : Render Services, Inc., 525 Brannan Street, Suite 300, San Francisco, CA 94107, États-Unis, téléphone +1 415 319 8186 (render.com). Serveurs utilisés : Francfort, Allemagne (Union européenne).'),
          t('Données et fichiers : Supabase Pte. Ltd (supabase.com). Serveurs utilisés : Irlande (Union européenne).'),
        ],
      },
      {
        title: t('Propriété intellectuelle'),
        body: [
          t('Le nom Kompaly, son logo, son personnage et son interface sont protégés. Les contenus que tu ajoutes (fichiers, notes, événements) restent ta propriété.'),
        ],
      },
    ],
  },
  confidentialite: {
    title: t('Politique de confidentialité'),
    sections: [
      {
        title: t('En bref'),
        body: [
          t('Kompaly collecte seulement ce qu’il faut pour faire fonctionner ton espace de travail. Pas de publicité, pas de revente de données, pas de traceurs publicitaires.'),
          t('Responsable du traitement : l’éditeur indiqué dans les mentions légales. Contact : {email}.', { email: CONTACT }),
        ],
      },
      {
        title: t('Données collectées'),
        body: [
          t('Compte : prénom, adresse e-mail, mot de passe (enregistré sous forme chiffrée, jamais lisible), double authentification.'),
          t('Contenus : fichiers du Drive, notes, événements, tâches, sessions de concentration, groupes et agendas partagés et ce que tu y partages, enregistrements (le texte écrit à partir du son, tes mots-clés et les documents créés), réglages (thème, profil d’études ou de travail facultatif).'),
          t('Technique : journaux d’erreurs du serveur (page concernée et message d’erreur, sans le contenu de tes documents) pour corriger les bugs.'),
          t('Messages « Avis ou bug » : ton message, la page ouverte et le type d’appareil (navigateur, système, taille d’écran).'),
          t('Signalements dans un groupe : la raison choisie, ta précision éventuelle et une copie du contenu signalé (titre et début du texte, ou nom du fichier).'),
          t('Rappels : l’heure et le texte de tes prochains rappels (titre de l’événement ou de la tâche). Si tu actives les notifications, pour chaque appareil : l’adresse d’envoi fournie par ton navigateur avec ses clés de chiffrement et le type d’appareil (par exemple « iPhone · Safari »).'),
        ],
      },
      {
        title: t('Pourquoi et sur quelle base'),
        body: [
          t('Fournir le service que tu demandes en créant ton compte (exécution du contrat) : stocker et synchroniser tes contenus, les partager dans les groupes que tu rejoins, sécuriser ton compte.'),
          t('Garder le service sûr et fiable (intérêt légitime) : limites anti-abus, vérification anti-robot à l’inscription et à la connexion, journaux d’erreurs, traitement des signalements.'),
          t('Améliorer Kompaly (intérêt légitime) : lire les avis et corriger les bugs que tu nous envoies, et compter les visites de façon anonyme (voir « Stockage sur ton appareil »).'),
        ],
      },
      {
        title: t('Kompaly et l’intelligence artificielle'),
        body: [
          t('Quand tu poses une question à Kompaly en mode intelligent, ton message et les éléments nécessaires pour y répondre (par exemple le texte d’un fichier que tu lui demandes de lire) sont envoyés au fournisseur d’IA : Groq, Inc. (États-Unis). Groq ne conserve ni tes messages ni les réponses (option « zéro conservation » activée).'),
          t('Ce transfert hors de l’Union européenne est encadré par les clauses contractuelles types de la Commission européenne, prévues dans le contrat de traitement des données de Groq. Le mode simple de Kompaly fonctionne sans rien envoyer.'),
          t('N’envoie pas à Kompaly d’informations sensibles (santé, données d’autres personnes…).'),
        ],
      },
      {
        title: t('Enregistrer un cours ou une réunion'),
        body: [
          t('Quand tu enregistres un cours, une réunion ou autre chose, le son (de ton micro, ou de l’ordinateur quand tu partages un onglet ou ton écran) est découpé en morceaux d’une vingtaine de secondes, envoyés un par un à Groq pour être écrits en texte (avec le titre, tes mots-clés et la fin du passage précédent, pour mieux reconnaître les mots), puis effacés : ni Kompaly ni Groq ne gardent le son. Les moments où personne ne parle ne sont pas envoyés.'),
          t('Avec le micro, le navigateur peut aussi écrire les mots en direct avec sa propre reconnaissance vocale (celle de Google dans Chrome, d’Apple dans Safari), selon les règles de ce navigateur.'),
          t('Le texte est ensuite rédigé (cours, compte rendu, fiche de révision, résumé, examen ou questions) par le fournisseur d’IA indiqué plus haut, et les documents sont rangés dans ton Drive. C’est le même fournisseur qui fait une fiche ou un examen à partir d’un document de ton Drive quand tu le demandes (clic droit sur le fichier) : le texte du document lui est alors envoyé. Pendant l’enregistrement, la transcription est gardée sur ton appareil pour ne rien perdre si la page se ferme.'),
          t('Si tu actives « Alertes aussi sur mon téléphone », le mot-clé entendu et la phrase où il a été dit sont envoyés à tes autres appareils par notification (voir « Qui y a accès »).'),
          t('Enregistrer quelqu’un demande son accord : demande-le au professeur, à tes collègues ou aux personnes présentes avant de commencer.'),
        ],
      },
      {
        title: t('Qui y a accès'),
        body: [
          t('Personne d’autre que toi pour ton espace personnel. Les membres d’un groupe voient ce qui est partagé dans ce groupe.'),
          t('L’administrateur du site (l’éditeur) voit la liste des comptes pour faire fonctionner le service : prénom, e-mail, dates d’inscription et de dernière connexion, double authentification activée ou non, nombre de notes, d’événements et de fichiers, espace utilisé, noms des catégories que tu crées (sans tes événements). Il lit aussi les messages « Avis ou bug » et les signalements, avec la copie du contenu signalé. Jamais le reste du contenu de tes notes, fichiers ou événements.'),
          t('Nos sous-traitants techniques les traitent uniquement pour faire fonctionner le service : Render (hébergement du site, serveurs à Francfort, Allemagne), Supabase (comptes, données et fichiers, serveurs en Irlande), Resend (envoi des e-mails du compte : confirmation, mot de passe oublié ; reçoit ton adresse e-mail, serveurs en Irlande), Cloudflare (vérification anti-robot Turnstile à l’inscription et à la connexion : reçoit ton adresse IP et des informations sur ton navigateur le temps de la vérification, sans pistage publicitaire ; et mesure d’audience anonyme ; contrat de traitement et clauses contractuelles types) et Groq (fournisseur d’IA indiqué plus haut, et transcription du son des enregistrements, sans conservation).'),
          t('Les notifications passent par le service de notifications de ton navigateur ou de ton téléphone (Google pour Chrome et Android, Apple pour Safari et iPhone, Mozilla pour Firefox, Microsoft pour Edge) : le message est chiffré de bout en bout, ce service ne peut pas le lire, il le transmet seulement à ton appareil.'),
        ],
      },
      {
        title: t('Durée de conservation'),
        body: [
          t('Tant que ton compte existe. Ce que tu mets à la corbeille est supprimé définitivement au bout de 30 jours.'),
          t('« Supprimer définitivement mon compte » (Profil › Compte) efface immédiatement ton compte, tes contenus et tes fichiers en ligne. Un rappel est effacé de nos serveurs une semaine après son envoi ; un appareil cesse d’en recevoir dès que tu désactives les notifications, que tu te déconnectes sans « Garder la session ouverte sur cet appareil » ou que tu le retires. Les journaux d’erreurs sont gardés au plus 12 mois, les messages « Avis ou bug » et les signalements au plus 2 ans (sans ton nom ni ton e-mail une fois ton compte supprimé).'),
        ],
      },
      {
        title: t('Stockage sur ton appareil'),
        body: [
          t('Kompaly garde une copie de tes données dans ton navigateur pour fonctionner vite et hors ligne, et pour rester connecté. Il s’agit uniquement de stockage nécessaire au service : aucun cookie publicitaire ni de mesure d’audience, donc pas de bandeau de consentement.'),
          t('Pour savoir combien de personnes utilisent Kompaly et si les pages s’affichent vite, nous comptons les visites avec Cloudflare Web Analytics : la page vue, le site d’où tu viens, ton pays, le type d’appareil et de navigateur, le temps d’affichage. Sans cookie, sans rien enregistrer sur ton appareil et sans identifiant : une visite ne peut pas être reliée à toi ni à tes visites suivantes, et rien n’est utilisé pour de la publicité.'),
          t('Avec « Garder la session ouverte sur cet appareil » (case de la page de connexion), ton compte reste proposé sur la page de connexion de cet appareil (prénom, e-mail et session) pour l’ouvrir en un clic, même après une déconnexion ; au bout de 14 jours sans l’ouvrir, le mot de passe est redemandé. « Retirer de cet appareil » (la croix à côté du compte) l’efface et ferme sa session. Sans cette case, la déconnexion efface la copie et la session.'),
        ],
      },
      {
        title: t('Tes droits'),
        body: [
          t('Tu peux accéder à tes données, les corriger, les exporter (Profil › Données › Exporter) et les supprimer (Profil › Compte). Tu peux aussi t’opposer à un traitement ou en demander la limitation en écrivant à {email}.', { email: CONTACT }),
          t('Si tu estimes que tes droits ne sont pas respectés, tu peux saisir la CNIL (cnil.fr).'),
          t('Si tu as moins de 15 ans, demande à un parent de lire cette page avec toi.'),
        ],
      },
    ],
  },
  conditions: {
    title: t('Conditions d’utilisation'),
    sections: [
      {
        title: t('Le service'),
        body: [
          t('Kompaly est un espace pour s’organiser (études, travail ou vie perso) : Drive, calendrier, notes, tâches, groupes et agendas partagés, enregistrement de cours ou de réunions, et l’ami Kompaly qui t’accompagne. Il est proposé gratuitement, en l’état, et peut évoluer.'),
          t('En créant un compte, tu acceptes ces conditions et la politique de confidentialité.'),
        ],
      },
      {
        title: t('Ton compte'),
        body: [
          t('Kompaly est ouvert dès 15 ans. Avant 15 ans, il faut l’accord d’un parent ou d’un responsable légal pour créer un compte.'),
          t('Une vérification anti-robot peut être demandée à l’inscription et à la connexion.'),
          t('Tu es responsable de ton mot de passe et, si tu l’actives, de ton téléphone de double authentification. Garde ta clé de secours en lieu sûr : sans elle, un téléphone perdu peut bloquer l’accès au compte.'),
          t('Limites actuelles : 50 Mo par fichier, 1 Go d’espace par compte, un nombre limité de questions par jour à Kompaly en mode intelligent et de minutes d’enregistrement écrites par jour.'),
        ],
      },
      {
        title: t('Ce qui est interdit'),
        body: [
          t('Déposer ou partager des contenus illégaux, haineux, violents, ou qui portent atteinte aux droits d’autrui (droit d’auteur, vie privée).'),
          t('Enregistrer des personnes sans leur accord.'),
          t('Tenter de contourner la sécurité, les limites ou d’accéder aux données d’autres utilisateurs ; utiliser le service de façon automatisée ou abusive.'),
          t('Nous pouvons supprimer un contenu signalé comme illicite et suspendre un compte qui ne respecte pas ces règles. Pour signaler un contenu d’un groupe : le bouton « Signaler » (le drapeau) à côté de ce contenu, ou un e-mail à {email}. Chaque signalement est examiné, et le contenu retiré s’il ne respecte pas ces règles.', { email: CONTACT }),
        ],
      },
      {
        title: t('L’ami Kompaly'),
        body: [
          t('Kompaly est une intelligence artificielle : il peut se tromper. Vérifie ce qu’il te dit, surtout pour tes cours, tes dates importantes et tes échéances. Il te demande toujours de confirmer avant de supprimer quelque chose.'),
          t('Les documents écrits à partir d’un enregistrement ou d’un fichier (cours, compte rendu, fiche, résumé, examen) sont rédigés par l’IA à partir d’une transcription automatique : relis-les avant de t’en servir.'),
        ],
      },
      {
        title: t('Responsabilité'),
        body: [
          t('Nous faisons le maximum pour que le service soit disponible et que tes données soient protégées, sans pouvoir le garantir à 100 %. Exporte régulièrement une sauvegarde de ce qui compte pour toi.'),
        ],
      },
      {
        title: t('Fin et modifications'),
        body: [
          t('Tu peux supprimer ton compte à tout moment. Si ces conditions changent de façon importante, tu en seras informé dans l’appli.'),
          t('Ces conditions sont soumises au droit français.'),
        ],
      },
    ],
  },
};

/** French typography: no « : », « ? », « ! », « ; » or « » » alone at the start of a line,
 *  and a number stays with its unit (« 100 % », « 15 ans », « 30 jours », « 50 Mo ») or the rest of a phone number. */
const frenchSpaces = (text: string) =>
  text
    .replace(/ ([:;?!»])/g, '\u00a0$1')
    .replace(/« /g, '«\u00a0')
    .replace(/(\d) (?=%|(?:ans|jours|mois|min|Mo|Go)(?![\p{L}\p{N}])|\d)/gu, '$1\u00a0');

export default function LegalPage({ doc }: { doc: LegalDoc }) {
  const { title, sections } = DOCS[doc];
  return (
    <div className="h-full overflow-y-auto bg-paper px-6 py-6 sm:px-10">
      {/* inline-flex: around a block child, the focus outline of an inline link was drawn on an empty box. */}
      <Link to="/" aria-label={t('Accueil')} className="inline-flex rounded-md pointer-coarse:py-1">
        <Logo />
      </Link>
      <main>
      <article className="mx-auto max-w-[680px] py-10">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{title}</h1>
        <p className="mt-1 text-[12px] text-stone-500">{t('Mise à jour\u00a0: {date}', { date: UPDATED })}</p>
        {lang !== 'fr' && <p className="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-[12.5px] text-stone-600">{t('Traduction pour information : seule la version française fait foi.')}</p>}
        {sections.map(s => (
          <section key={s.title} className="mt-8">
            <h2 className="text-[15px] font-semibold">{s.title}</h2>
            {s.body.map(p => (
              <p key={p} className="mt-2 text-[14px] leading-relaxed text-stone-700">
                {frenchSpaces(p).split(CONTACT).flatMap((part, i) =>
                  i === 0
                    ? [part]
                    : [
                        <a key={i} href={`mailto:${CONTACT}`} className="text-ink underline decoration-stone-300 underline-offset-2 hover:decoration-ink">
                          {CONTACT}
                        </a>,
                        part,
                      ],
                )}
              </p>
            ))}
          </section>
        ))}
        <nav aria-label={t('Informations légales')} className="mt-12 flex flex-wrap gap-x-4 border-t border-stone-200 pt-2 text-[13px] text-stone-500">
          {LEGAL_LINKS.map(l => (
            // NavLink: the page being read is marked (aria-current) and not underlined.
            <NavLink key={l.to} to={l.to} className="inline-block py-2 underline decoration-stone-300 underline-offset-4 hover:text-ink aria-[current=page]:font-medium aria-[current=page]:text-ink aria-[current=page]:no-underline">
              {l.label}
            </NavLink>
          ))}
        </nav>
      </article>
      </main>
    </div>
  );
}
