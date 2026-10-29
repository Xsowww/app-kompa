# Kompaly

L’espace de travail pour les études, le travail ou la vie perso (l'usage se choisit au questionnaire de bienvenue et change les mots de l'appli) : **Drive**, **Calendrier**, **Notes**, tâches et **Enregistrer** (cours ou réunions écrits et résumés) réunis dans une seule appli, avec Kompaly, un petit compagnon IA qui se cache sur le bord de l'écran et aide à s'organiser.

## Démarrer

```bash
npm install
cp .env.example .env   # facultatif : choisis une IA (gratuite) pour Kompaly, voir plus bas
npm run dev            # http://localhost:5173
```

En production :

```bash
npm run build
npm start              # sert l'appli + l'API de Kompaly sur http://localhost:3000
```

Vérifications (lancées aussi par GitHub à chaque envoi, voir `.github/workflows/ci.yml`) :

```bash
npm run lint && npm test && npm run build
```

Node 22+ (voir `.nvmrc`). Un devcontainer est fourni pour GitHub Codespaces.

## Ce que contient l'appli

| Espace | Fonctionnalités |
| --- | --- |
| **Connexion / inscription** | Comptes multiples sur le même navigateur, mot de passe haché (PBKDF2), chaque compte a ses propres données. Un nouveau compte reçoit quelques éléments de départ. |
| **Dashboard** | Cinq cartes : aujourd'hui (et ce qui suit), prochain examen (J-x, bouton « Planifier les révisions »), « À faire » (ajout rapide de tâches), cette semaine (charge par jour), notes récentes. |
| **Drive** | Importer des fichiers ou un dossier entier (bouton ou glisser-déposer depuis l'ordinateur), créer, renommer (F2), supprimer, copier / couper / coller (Ctrl+C / X / V), dupliquer (Ctrl+D), déplacer par glisser-déposer ou via « Déplacer vers… », Alt+glisser pour copier, sélection multiple (Ctrl / Maj + clic, Ctrl+A), clic droit, favoris, récents, vue grille ou liste avec tri, aperçu (images, PDF, vidéo, audio, texte, Word, PowerPoint) et téléchargement, suppression vers la corbeille (« Annuler » juste après), couleurs de dossiers, étiquettes avec filtre, **recherche dans le contenu** des PDF / Word / textes, partage d'un fichier par lien temporaire (version en ligne). |
| **Calendrier** | Ajout en langage naturel (« Exam de maths vendredi 14h », « Sport demain 18h-19h »), catégorie devinée automatiquement (cours, examen, devoir, perso, sport), bande de la semaine et vue mois, agenda du jour avec cases « c'est fait », examens à venir avec J-x, devoirs à rendre, filtres par catégorie, vue **Jour** heure par heure, déplacer un événement en le glissant (jour ou heure), **import d'emploi du temps .ics** (ENT, Google Agenda ; cours répétés compris, sans doublon en cas de réimport), notes liées à un événement, **périodes** (vacances, stage, en entreprise…) en un ou plusieurs morceaux, double-clic sur un événement pour le modifier. Chaque suppression demande une confirmation. |
| **Notes** | Dossiers et sous-dossiers, créer / renommer / dupliquer / épingler / supprimer, glisser une note ou un dossier dans un autre dossier, recherche, éditeur riche (titres, gras, surlignage, listes, cases à cocher, citations, code, liens, images), sauvegarde automatique, suppression vers la corbeille, **modèles** (fiche de révision, compte-rendu de TP, plan de dissertation, cours magistral, exposé), lier une note à des fichiers et événements, export PDF et Markdown. |
| **Corbeille** | Une seule corbeille pour tout le site, toujours à portée (bas de la barre latérale, icône en haut sur mobile) : notes, dossiers de notes, fichiers et dossiers du Drive, événements du calendrier. Aperçu en lecture seule, restaurer (à la racine si le dossier d'origine n'existe plus), supprimer définitivement, filtres par espace, sélection multiple, vider. Tout est effacé après 30 jours. |
| **Profil et réglages** | En cliquant sur le profil en bas à gauche. Photo ou couleur d'avatar, établissement/filière/année (connus de Kompaly), statistiques (série de jours, tâches, examens, sessions focus, notes, fichiers), thème clair / sombre / automatique, couleur d'accent (6 choix, jusqu'au casque de Kompaly), réduire les animations, réglages de Kompaly (affichage, initiatives, rappels, bavardage, séances de révision), sessions focus (Pomodoro), raccourcis clavier, notifications du navigateur, export/import de sauvegarde, export du calendrier en .ics, stockage utilisé, changement de mot de passe, double authentification (associer un autre téléphone), déconnexion, suppression du compte. |
| **Double authentification** | En mode en ligne, obligatoire pour chaque compte : à l'inscription, un QR code s'affiche ; on le scanne avec l'appareil photo (iPhone : Mots de passe) ou Google/Microsoft Authenticator, qui affiche un code à 6 chiffres à taper sur le site. Le code est redemandé à chaque connexion. La base elle-même refuse les données sans ce code (règles « 2fa obligatoire »). Téléphone perdu : Supabase › Authentication › Users › le compte › supprimer le facteur MFA, le QR code sera reproposé. |
| **Administration** | `/admin`, visible uniquement pour les comptes listés dans la table `admins` (et connectés avec leur code) : comptes, actifs, 2FA, stockage, notes, événements, fichiers, activité et inscriptions des 30 derniers jours, répartition du calendrier, liste des comptes avec recherche. Mise à jour en direct toutes les 20 s. Seulement des chiffres, jamais le contenu. Ajouter un admin : voir la fin de `supabase/schema.sql`. |
| **Session focus** | Minuteur Pomodoro en bas de la barre latérale : on choisit la matière, travail puis pause, son de fin, notification, Kompaly te félicite. |
| **Tâches** | `/taches` (ancien `/progression`, redirigé) : liste de tâches indépendante du calendrier (en retard, aujourd'hui, à venir, sans échéance) et temps de travail de la semaine par matière, graphiques détaillés et vue tableau derrière « Voir le détail ». Les 18 badges sont dans Profil › Profil ; leur annonce par Kompaly est désactivée par défaut. |
| **Enregistrer** | `/enregistrer` (version en ligne ; sur téléphone, depuis l'accueil) : enregistre un cours, une réunion ou une conférence, au **micro** ou avec le **son de l'ordinateur** (Chrome / Edge sur ordinateur : onglet ou écran entier avec le son). Texte écrit en direct (Whisper via Groq, par morceaux d'environ 20 s ; le son n'est jamais gardé), **mots-clés** surlignés qui envoient une notification (aussi sur le téléphone), bouton « Moment important » (touche M), pastille « REC » sur toutes les pages. À la fin, l'IA rédige le cours (ou le compte rendu pour le travail) et, au choix, la fiche de révision (résumé) et l'examen d'entraînement (questions, quiz), rangés en Word dans le dossier du Drive choisi ; ceux non cochés se font plus tard depuis la liste. Dans le Drive, clic droit sur un Word, PDF ou texte › « Faire une fiche de révision » / « Faire un examen d'entraînement ». Réglages : voir « Enregistrer : transcription » plus bas. |
| **Groupes** | `/groupes` (version en ligne) : créer un groupe ou le rejoindre avec un code à 6 caractères, notes partagées modifiables par tous (mises à jour en direct, sans écraser le travail d'un autre), révisions en commun avec « Je viens » et ajout à son calendrier, membres (prénoms uniquement). **Agendas partagés** (`/agendas`) : un calendrier commun séparé du sien, chacun y ajoute événements et périodes, « Pour qui » (tout le monde ou certains membres), notification aux autres, import des périodes d'un autre agenda. |
| **Kompaly** | Personnage accroché au bord droit de l'écran, présent sur toutes les pages. Clic pour lui parler, glisser pour le déplacer le long du bord. Voir plus bas. |

Recherche globale dans la barre du haut (Ctrl+K) : fichiers, dossiers, notes et événements.

**Accessibilité** : tout se fait au clavier (lien « Aller au contenu », menus contextuels avec Maj+F10, fenêtres qui gardent le focus et se ferment avec Échap), libellés pour les lecteurs d'écran, annonces des notifications et des messages de Kompaly, contrastes vérifiés dans les deux thèmes, animations réduites si le système le demande.

## Kompaly

Petit personnage (casque de pilote) accroché au bord droit de l'écran : il suit la souris des yeux, cligne, passe la tête, s'endort si tu ne fais rien, et réagit selon la situation (content, surpris, qui réfléchit…).

**Il prend des initiatives** (`src/copilot/proactive.ts`) : examen ajouté → propose de planifier des révisions ou de créer une fiche, examen proche sans révisions, devoir à rendre demain, devoir en retard, événement qui commence dans 20 minutes, veille d'examen, journée terminée, premier import… Ses propositions ont de vrais boutons (« Planifier mes révisions » crée les créneaux et la fiche), et répondre « oui » suffit. Il ne se répète pas et laisse au moins 75 s entre deux remarques.

- **Point du matin** : à la première ouverture de la journée, avant midi, « ta journée en 3 lignes » (événements du jour, tâches à faire, prochain examen) avec un bouton vers le calendrier.
- **Bilan du dimanche** : à partir de 17 h, une fois par semaine : fait / prévu, temps de concentration par matière (sessions focus), ce qui arrive la semaine suivante.
- Les deux se règlent dans Profil › Kompaly et ne sont jamais répétés (mémorisés dans sa mémoire). En mode « Discret », le point du matin ne s'affiche que s'il y a quelque chose à dire.

**Il répond à tout** : culture générale, aide aux devoirs (méthode puis réponse), maths pas à pas, rédaction, conseils… avec une longueur adaptée (court pour discuter, structuré pour expliquer). Ses réponses sont mises en forme (gras, italique, listes, code) par un petit moteur Markdown maison qui ne produit que du texte React : aucun HTML n'est injecté. La fenêtre s'agrandit pour les longues réponses, chaque longue réponse a un bouton « Copier ».

**Il agit sur le site** (outils exécutés dans le navigateur, sur les données de l'étudiant) : chercher partout ou dans le texte des notes, lire une note ou **un fichier du Drive** (PDF, docx, txt, md, csv, json ; ~30 000 caractères max) pour en faire une fiche ou un quiz, créer / déplacer / supprimer des événements, planifier des révisions, créer ou compléter des notes, créer / renommer / déplacer des dossiers et fichiers, favoris, couleur des dossiers, corbeille (mettre à la corbeille, lister, restaurer), tâches (ajouter, cocher, supprimer), session focus (lancer sur une matière, arrêter), réglages (couleur, thème, animations, bavardage). Avant une suppression ou une mise à la corbeille, il demande confirmation.

**Révisions** : « Interroge-moi sur ma note de chimie » → avec l'IA, il lit la note (ou le PDF) et pose les questions une par une en corrigeant. Sans IA, il fabrique des questions à partir de la structure de la note (titres, « terme : définition », mots en **gras** à compléter) et vérifie les réponses avec tolérance (accents, fautes de frappe, mots-clés).

**Personnalité** (Profil › Kompaly) : Meilleur pote (par défaut), Coach motivant, Prof patient, Zen ou Taquin, plus un champ libre « Tes instructions pour Kompaly » (600 caractères, par ex. « Appelle-moi Capitaine, parle-moi de foot »). Le serveur assemble les règles de base (honnêteté, sécurité, outils, français, tutoiement), le style choisi et ces instructions, présentées comme des préférences qui ne peuvent pas lever les règles de base.

**À la voix** : bouton micro dans la conversation (reconnaissance vocale du navigateur, en français, texte affiché pendant que tu parles, envoi automatique à la fin ; masqué si le navigateur ne la gère pas, comme Firefox). Option « Lire ses réponses à voix haute » (voix française de l'appareil), avec un bouton pour arrêter la lecture.

### Brancher une IA (gratuite ou non)

Sans IA, Kompaly comprend des commandes en français (« Trouve le dossier Maths », « Ajoute Partiel de chimie vendredi 10h », « Ajoute la tâche acheter une calculatrice », « Mets Brouillon à la corbeille », « Lance une session focus sur les maths », « Mode sombre », « Interroge-moi sur Histoire »…). En cas de souci avec l'IA, il bascule automatiquement sur ce mode.

Pour qu'il comprenne tout, choisis un fournisseur dans `.env` (détails dans `.env.example`) :

| `AI_PROVIDER` | Prix | Modèle par défaut | Clé |
| --- | --- | --- | --- |
| `gemini` | gratuit (limites par minute et par jour) | `gemini-2.5-flash` | [Google AI Studio](https://aistudio.google.com/apikey) |
| `groq` | gratuit (≈ 1 000 requêtes/jour et 8 000 tokens/min pour tout le site ; quand c’est épuisé, Kompaly passe tout seul en mode simple) | `openai/gpt-oss-120b` (autres choix : `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`) | [console.groq.com](https://console.groq.com/keys) |
| `openrouter` | gratuit avec les modèles `:free` | `meta-llama/llama-3.3-70b-instruct:free` | [openrouter.ai](https://openrouter.ai/keys) |
| `mistral` | offre gratuite « Experiment » | `mistral-small-latest` | [console.mistral.ai](https://console.mistral.ai) |
| `ollama` | gratuit, tourne sur ta machine | `llama3.1` | aucune ([ollama.com](https://ollama.com)) |
| `anthropic` | payant | `claude-haiku-5-5` | [console.anthropic.com](https://console.anthropic.com) |
| `openai-compatible` | selon le service | `AI_MODEL` | `AI_BASE_URL` + `AI_API_KEY` |

**Ne plus recréer `.env` à chaque lancement** : `AI_PROVIDER=groq` est déjà dans la configuration publique du projet (`.env.supabase.public`). Il ne reste que la clé, à enregistrer **une seule fois** comme secret, jamais dans le code :
- **GitHub Codespaces** : github.com › Settings › Codespaces › Secrets › *New secret* : nom `AI_API_KEY`, valeur = ta clé, dépôt `COP-PILOT`. Chaque Codespace l'a automatiquement (redémarre un Codespace déjà ouvert).
- **Hébergeur** (Render, Railway…) : variable d'environnement `AI_API_KEY`.
- **Sur ton ordinateur** : un fichier `.env` avec `AI_API_KEY=…` (il reste d'un lancement à l'autre).

Dans le chat, la ligne sous « Kompaly » indique « Mode intelligent · Groq » ou « Mode simple · IA dans 0:42 » (compte à rebours quand le quota gratuit est atteint).

Exemple gratuit en trois lignes :

```bash
AI_PROVIDER=gemini
AI_API_KEY=ta-cle-google-ai-studio
# AI_MODEL=gemini-2.5-flash   (facultatif)
```

### Enregistrer : transcription

La page « Enregistrer » envoie le son à un service de reconnaissance vocale (`server/cours.mjs`, API `/api/cours/*`), puis fait rédiger le texte par l'IA ci-dessus. Avec `AI_PROVIDER=groq`, rien à ajouter : la même clé sert à Whisper (`whisper-large-v3-turbo`). Sinon (détails dans `.env.example`) :

| Variable | Rôle |
| --- | --- |
| `TRANSCRIBE_API_KEY` | clé Groq ([console.groq.com](https://console.groq.com/keys)) ou d'un service compatible OpenAI `/audio/transcriptions` |
| `TRANSCRIBE_BASE_URL`, `TRANSCRIBE_MODEL` | autre service ou autre modèle (facultatif) |
| `TRANSCRIBE_DAILY_MINUTES` | minutes de son par compte et par jour (240 par défaut) |
| `TRANSCRIBE_SITE_MINUTES` | minutes pour tout le site par jour (450 par défaut avec Groq gratuit, qui en accepte environ 8 h) |

Sans clé, la page s'ouvre mais affiche « La transcription est indisponible pour le moment ».

Puis relance `npm run dev`. L'onglet Profil › Kompaly affiche le fournisseur utilisé (aussi au survol de « Dans le coin » dans la conversation). Une ancienne configuration avec seulement `ANTHROPIC_API_KEY` continue de marcher.

Comment ça marche : la personnalité et les outils sont définis côté serveur (`server/copilotPrompt.mjs`). Claude passe par le SDK Anthropic ; les autres fournisseurs parlent le format « chat completions » d'OpenAI, et `server/aiProviders.mjs` convertit la conversation et les outils dans ce format puis la réponse dans le format Anthropic, si bien que le navigateur (`src/copilot/claudeBrain.ts`) ne voit aucune différence. Les erreurs sont harmonisées (clé invalide, quota atteint, panne, délai dépassé). La clé n'est jamais envoyée au navigateur.

**Confidentialité, à savoir** : ce que tu écris à Kompaly, et ce qu'il lit pour te répondre (contexte du calendrier, notes ou fichiers qu'il ouvre), est envoyé au fournisseur choisi. Les offres gratuites ne sont pas neutres : **l'offre gratuite de Gemini autorise Google à utiliser les échanges pour améliorer ses modèles** (et des personnes peuvent les relire) ; certains modèles gratuits d'OpenRouter sont fournis par des hébergeurs qui conservent les données ; vérifie les conditions de Groq et Mistral selon ton offre. Évite d'y mettre des informations sensibles, ou choisis **Ollama** (tout reste sur ta machine) ou une offre payante dont les conditions excluent l'entraînement. Les petits modèles gratuits se trompent plus souvent dans l'usage des outils que Claude.

## Base de données en ligne (Supabase)

**Déjà configuré** : le projet Supabase `cop-pilot` (Europe) est branché via `.env.supabase.public` (URL + clé *publishable*, faites pour être publiques ; la sécurité repose sur les règles de la base). Il suffit de lancer `npm run dev`. Pour repasser en mode local, supprime ce fichier ou vide ses valeurs dans `.env`.

Pour un nouveau projet Supabase :

Sans configuration, comptes et données restent dans le navigateur. Avec Supabase (gratuit), tout est en ligne et sécurisé : vrais comptes avec confirmation par e-mail et mot de passe oublié, données accessibles depuis n'importe quel appareil, fichiers du Drive dans un stockage privé, et chaque étudiant ne peut accéder qu'à ses propres données (Row Level Security).

1. Crée un compte sur [supabase.com](https://supabase.com), puis **New project** (région Europe : Paris ou Francfort).
2. **SQL Editor › New query** : colle le contenu de `supabase/schema.sql` et clique sur **Run**. Ça crée les tables, la sécurité (dont la double authentification), le stockage des fichiers, la suppression de compte et le tableau de bord admin. Les projets existants appliquent les fichiers de `supabase/migrations/`.
   Puis **Authentication › Multi-Factor** : laisse TOTP activé.
3. **Project Settings › API** : copie l'URL du projet et la clé `anon` / `publishable` dans `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
4. **Authentication › URL Configuration** : *Site URL* = l'adresse du site (`http://localhost:5173` en développement), et ajoute `http://localhost:5173/**` dans *Redirect URLs* (et l'adresse de production plus tard).
5. **Authentication › Providers › Email** : laisse « Confirm email » activé, mot de passe de 8 caractères minimum.
6. Relance `npm run dev`. Crée un compte, confirme l'e-mail, connecte-toi.

Comment ça marche : l'appli garde une copie locale pour rester instantanée ; chaque modification est envoyée à Supabase en arrière-plan (`src/lib/cloudSync.ts`), regroupée et renvoyée automatiquement en cas de coupure, y compris si l'onglet est fermé juste après. En revenant sur l'onglet, les changements faits sur un autre appareil sont récupérés. En mode en ligne, l'API de Kompaly n'accepte que les étudiants connectés.

## Architecture

```
src/
  App.tsx                 routes (connexion, inscription, espace protégé)
  layout/AppShell.tsx     barre latérale, recherche globale, navigation mobile, Kompaly
  pages/                  Dashboard, drive/, calendar/, notes/, tasks/, groups/, trash/,
                          record/ (Enregistrer, pastille REC), profile/, admin/, AuthPage, MfaPage
  copilot/                Character (personnage SVG), Kompaly (conversation), actions,
                          offers (boutons d'action), proactive (initiatives),
                          localBrain (mode simple), claudeBrain (mode IA, via le serveur),
                          Markdown (mise en forme sûre), voice (micro, lecture), quiz, fileText
server/
  copilot.mjs             API /api/copilot : authentification, limite, appel à l'IA
  copilotPrompt.mjs       personnalité, styles, outils, pages de l'appli
  cours.mjs               API /api/cours : transcription du son, rédaction du cours, fiche, examen, alertes
  aiProviders.mjs         choix du fournisseur, adaptateur format OpenAI ↔ Anthropic
  index.mjs               serveur de production (dist/ compressé, en-têtes de sécurité, API)
src/store/                état Zustand : auth, session, drive, calendar, notes, todos, groups,
                          groupActivity (pastilles), copilot, settings, ui, recorder (enregistrement)
src/lib/                  cloudSync (synchro Supabase), blobStore (fichiers), groups, ics,
                          dates (langage naturel), textIndex et docText (texte des PDF/Word),
                          trash, backup, badges, utilitaires
supabase/                 schema.sql (base complète) et migrations/ (projets existants)
tests/                    tests automatiques (npm test)
```

## Limites actuelles (version de démonstration)

- **En mode local** (sans Supabase), comptes et données sont stockés dans le navigateur : changer de navigateur ou vider les données du site efface tout. Configure Supabase (voir plus haut) pour un usage réel.
- En mode local, l'API de Kompaly n'a qu'une limite par adresse IP : active Supabase avant une mise en ligne publique pour qu'elle soit réservée aux comptes connectés.
- Les modifications faites en même temps sur deux appareils : la dernière enregistrée l'emporte.
