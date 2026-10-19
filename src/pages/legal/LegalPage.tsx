import { Link, NavLink } from 'react-router-dom';
import Logo from '../../components/Logo';
import { LEGAL_LINKS } from './links';

// Pages légales, lisibles sans compte. Les sous-traitants cités ici doivent rester à jour (registre des traitements).

export type LegalDoc = 'mentions' | 'confidentialite' | 'conditions';

const UPDATED = '18 octobre 2026';
const CONTACT = 'contact@kompaly.com';

type Section = { title: string; body: string[] };

const DOCS: Record<LegalDoc, { title: string; sections: Section[] }> = {
  mentions: {
    title: 'Mentions légales',
    sections: [
      {
        title: 'Éditeur du site',
        body: [
          'Kompaly est édité par Léo Boucher, particulier, à titre non professionnel.',
          'Comme le permet l’article 6, III, 2 de la loi pour la confiance dans l’économie numérique (LCEN), l’adresse de l’éditeur n’est pas publiée : son identité est connue de l’hébergeur. Contact : ' + CONTACT + '.',
          'Directeur de la publication : Léo Boucher.',
        ],
      },
      {
        title: 'Hébergement',
        body: [
          'Site : Render Services, Inc., 525 Brannan Street, Suite 300, San Francisco, CA 94107, États-Unis, téléphone +1 415 319 8186 (render.com). Serveurs utilisés : Francfort, Allemagne (Union européenne).',
          'Données et fichiers : Supabase Pte. Ltd (supabase.com). Serveurs utilisés : Irlande (Union européenne).',
        ],
      },
      {
        title: 'Propriété intellectuelle',
        body: [
          'Le nom Kompaly, son logo, son personnage et son interface sont protégés. Les contenus que tu ajoutes (fichiers, notes, événements) restent ta propriété.',
        ],
      },
    ],
  },
  confidentialite: {
    title: 'Politique de confidentialité',
    sections: [
      {
        title: 'En bref',
        body: [
          'Kompaly collecte seulement ce qu’il faut pour faire fonctionner ton espace de travail. Pas de publicité, pas de revente de données, pas de traceurs publicitaires.',
          'Responsable du traitement : l’éditeur indiqué dans les mentions légales. Contact : ' + CONTACT + '.',
        ],
      },
      {
        title: 'Données collectées',
        body: [
          'Compte : prénom, adresse e-mail, mot de passe (enregistré sous forme chiffrée, jamais lisible), double authentification.',
          'Contenus : fichiers du Drive, notes, événements, tâches, sessions de concentration, groupes et ce que tu y partages, réglages (thème, profil d’études facultatif).',
          'Technique : journaux d’erreurs du serveur (page concernée et message d’erreur, sans le contenu de tes documents) pour corriger les bugs.',
          'Messages « Avis ou bug » : ton message, la page ouverte et le type d’appareil (navigateur, système, taille d’écran).',
          'Signalements dans un groupe : la raison choisie, ta précision éventuelle et une copie du contenu signalé (titre et début du texte, ou nom du fichier).',
          'Rappels : l’heure et le texte de tes prochains rappels (titre de l’événement ou de la tâche). Si tu actives les notifications, pour chaque appareil : l’adresse d’envoi fournie par ton navigateur avec ses clés de chiffrement et le type d’appareil (par exemple « iPhone · Safari »).',
        ],
      },
      {
        title: 'Pourquoi et sur quelle base',
        body: [
          'Fournir le service que tu demandes en créant ton compte (exécution du contrat) : stocker et synchroniser tes contenus, les partager dans les groupes que tu rejoins, sécuriser ton compte.',
          'Garder le service sûr et fiable (intérêt légitime) : limites anti-abus, vérification anti-robot à l’inscription et à la connexion, journaux d’erreurs, traitement des signalements.',
          'Améliorer Kompaly (intérêt légitime) : lire les avis et corriger les bugs que tu nous envoies, et compter les visites de façon anonyme (voir « Stockage sur ton appareil »).',
        ],
      },
      {
        title: 'Kompaly et l’intelligence artificielle',
        body: [
          'Quand tu poses une question à Kompaly en mode intelligent, ton message et les éléments nécessaires pour y répondre (par exemple le texte d’un fichier que tu lui demandes de lire) sont envoyés au fournisseur d’IA : Groq, Inc. (États-Unis). Groq ne conserve ni tes messages ni les réponses (option « zéro conservation » activée).',
          'Ce transfert hors de l’Union européenne est encadré par les clauses contractuelles types de la Commission européenne, prévues dans le contrat de traitement des données de Groq. Le mode simple de Kompaly fonctionne sans rien envoyer.',
          'N’envoie pas à Kompaly d’informations sensibles (santé, données d’autres personnes…).',
        ],
      },
      {
        title: 'Enregistrer un cours',
        body: [
          'Quand tu enregistres un cours, le son (de ton micro ou de l’onglet que tu partages) est découpé en morceaux d’une vingtaine de secondes, envoyés un par un à Groq pour être écrits en texte, puis effacés : ni Kompaly ni Groq ne gardent le son. Les moments où personne ne parle ne sont pas envoyés.',
          'Avec le micro, le navigateur peut aussi écrire les mots en direct avec sa propre reconnaissance vocale (celle de Google dans Chrome, d’Apple dans Safari), selon les règles de ce navigateur.',
          'Le texte est ensuite rédigé en cours, fiche de révision ou examen par le fournisseur d’IA indiqué plus haut, et les documents sont rangés dans ton Drive. Pendant l’enregistrement, la transcription est gardée sur ton appareil pour ne rien perdre si la page se ferme.',
          'Enregistrer quelqu’un demande son accord : demande-le au professeur ou aux personnes présentes avant de commencer.',
        ],
      },
      {
        title: 'Qui y a accès',
        body: [
          'Personne d’autre que toi pour ton espace personnel. Les membres d’un groupe voient ce qui est partagé dans ce groupe.',
          'L’administrateur du site (l’éditeur) voit la liste des comptes pour faire fonctionner le service : prénom, e-mail, dates d’inscription et de dernière connexion, double authentification activée ou non, nombre de notes, d’événements et de fichiers, espace utilisé, noms des catégories que tu crées (sans tes événements). Il lit aussi les messages « Avis ou bug » et les signalements, avec la copie du contenu signalé. Jamais le reste du contenu de tes notes, fichiers ou événements.',
          'Nos sous-traitants techniques les traitent uniquement pour faire fonctionner le service : Render (hébergement du site, serveurs à Francfort, Allemagne), Supabase (comptes, données et fichiers, serveurs en Irlande), Resend (envoi des e-mails du compte : confirmation, mot de passe oublié ; reçoit ton adresse e-mail, serveurs en Irlande), Cloudflare (vérification anti-robot Turnstile à l’inscription et à la connexion : reçoit ton adresse IP et des informations sur ton navigateur le temps de la vérification, sans pistage publicitaire ; et mesure d’audience anonyme ; contrat de traitement et clauses contractuelles types) et le fournisseur d’IA indiqué plus haut.',
          'Les notifications passent par le service de notifications de ton navigateur ou de ton téléphone (Google pour Chrome et Android, Apple pour Safari et iPhone, Mozilla pour Firefox, Microsoft pour Edge) : le message est chiffré de bout en bout, ce service ne peut pas le lire, il le transmet seulement à ton appareil.',
        ],
      },
      {
        title: 'Durée de conservation',
        body: [
          'Tant que ton compte existe. Ce que tu mets à la corbeille est supprimé définitivement au bout de 30 jours.',
          '« Supprimer définitivement mon compte » (Profil › Compte) efface immédiatement ton compte, tes contenus et tes fichiers en ligne. Un rappel est effacé de nos serveurs une semaine après son envoi ; un appareil cesse d’en recevoir dès que tu désactives les notifications, que tu te déconnectes sans « Garder la session ouverte sur cet appareil » ou que tu le retires. Les journaux d’erreurs sont gardés au plus 12 mois, les messages « Avis ou bug » et les signalements au plus 2 ans (sans ton nom ni ton e-mail une fois ton compte supprimé).',
        ],
      },
      {
        title: 'Stockage sur ton appareil',
        body: [
          'Kompaly garde une copie de tes données dans ton navigateur pour fonctionner vite et hors ligne, et pour rester connecté. Il s’agit uniquement de stockage nécessaire au service : aucun cookie publicitaire ni de mesure d’audience, donc pas de bandeau de consentement.',
          'Pour savoir combien de personnes utilisent Kompaly et si les pages s’affichent vite, nous comptons les visites avec Cloudflare Web Analytics : la page vue, le site d’où tu viens, ton pays, le type d’appareil et de navigateur, le temps d’affichage. Sans cookie, sans rien enregistrer sur ton appareil et sans identifiant : une visite ne peut pas être reliée à toi ni à tes visites suivantes, et rien n’est utilisé pour de la publicité.',
          'Avec « Garder la session ouverte sur cet appareil » (case de la page de connexion), ton compte reste proposé sur la page de connexion de cet appareil (prénom, e-mail et session) pour l’ouvrir en un clic, même après une déconnexion ; au bout de 14 jours sans l’ouvrir, le mot de passe est redemandé. « Retirer de cet appareil » (la croix à côté du compte) l’efface et ferme sa session. Sans cette case, la déconnexion efface la copie et la session.',
        ],
      },
      {
        title: 'Tes droits',
        body: [
          'Tu peux accéder à tes données, les corriger, les exporter (Profil › Données › Exporter) et les supprimer (Profil › Compte). Tu peux aussi t’opposer à un traitement ou en demander la limitation en écrivant à ' + CONTACT + '.',
          'Si tu estimes que tes droits ne sont pas respectés, tu peux saisir la CNIL (cnil.fr).',
          'Si tu as moins de 15 ans, demande à un parent de lire cette page avec toi.',
        ],
      },
    ],
  },
  conditions: {
    title: 'Conditions d’utilisation',
    sections: [
      {
        title: 'Le service',
        body: [
          'Kompaly est un espace pour s’organiser (études, travail ou vie perso) : Drive, calendrier, notes, tâches, groupes, et l’ami Kompaly qui t’accompagne. Il est proposé gratuitement, en l’état, et peut évoluer.',
          'En créant un compte, tu acceptes ces conditions et la politique de confidentialité.',
        ],
      },
      {
        title: 'Ton compte',
        body: [
          'Kompaly est ouvert dès 15 ans. Avant 15 ans, il faut l’accord d’un parent ou d’un responsable légal pour créer un compte.',
          'Une vérification anti-robot peut être demandée à l’inscription et à la connexion.',
          'Tu es responsable de ton mot de passe et de ton téléphone de double authentification. Garde ta clé de secours en lieu sûr : sans elle, un téléphone perdu peut bloquer l’accès au compte.',
          'Limites actuelles : 50 Mo par fichier, 1 Go d’espace par compte, un nombre limité de questions par jour à Kompaly en mode intelligent.',
        ],
      },
      {
        title: 'Ce qui est interdit',
        body: [
          'Déposer ou partager des contenus illégaux, haineux, violents, ou qui portent atteinte aux droits d’autrui (droit d’auteur, vie privée).',
          'Tenter de contourner la sécurité, les limites ou d’accéder aux données d’autres utilisateurs ; utiliser le service de façon automatisée ou abusive.',
          'Nous pouvons supprimer un contenu signalé comme illicite et suspendre un compte qui ne respecte pas ces règles. Pour signaler un contenu d’un groupe : le bouton « Signaler » (le drapeau) à côté de ce contenu, ou un e-mail à ' + CONTACT + '. Chaque signalement est examiné, et le contenu retiré s’il ne respecte pas ces règles.',
        ],
      },
      {
        title: 'L’ami Kompaly',
        body: [
          'Kompaly est une intelligence artificielle : il peut se tromper. Vérifie ce qu’il te dit, surtout pour tes cours, tes dates d’examen et tes rendus. Il te demande toujours de confirmer avant de supprimer quelque chose.',
        ],
      },
      {
        title: 'Responsabilité',
        body: [
          'Nous faisons le maximum pour que le service soit disponible et que tes données soient protégées, sans pouvoir le garantir à 100 %. Exporte régulièrement une sauvegarde de ce qui compte pour toi.',
        ],
      },
      {
        title: 'Fin et modifications',
        body: [
          'Tu peux supprimer ton compte à tout moment. Si ces conditions changent de façon importante, tu en seras informé dans l’appli.',
          'Ces conditions sont soumises au droit français.',
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
      <Link to="/" aria-label="Accueil" className="inline-flex rounded-md pointer-coarse:py-1">
        <Logo />
      </Link>
      <main>
      <article className="mx-auto max-w-[680px] py-10">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{title}</h1>
        <p className="mt-1 text-[12px] text-stone-500">Mise à jour&nbsp;: {UPDATED}</p>
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
        <nav aria-label="Informations légales" className="mt-12 flex flex-wrap gap-x-4 border-t border-stone-200 pt-2 text-[13px] text-stone-500">
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
