# Avant le lancement — liste de travail (Kompaly)

Issue de l'audit complet du 13/10/2026. On coche au fur et à mesure.
Ensuite : le document de lancement (hébergement, domaine, stores, légal).

## Lot 1 — Sécurité et bugs rapides
- [x] Les PDF ne marchent pas en production (type `.mjs` du moteur PDF)
- [x] Aperçu « PDF » piégé qui exécute du code chez les autres membres
- [x] « Supprimer mon compte » contourne la 2FA (SQL à appliquer : `2026-10-13d_suppression_compte_2fa.sql`)
- [x] Images effacées quand on partage une note dans un groupe
- [x] Données lisibles sur l'ordinateur après déconnexion (PC partagés)
- [x] Impression d'une note : code caché d'une sauvegarde importée exécuté
- [x] Requête trop grosse : connexion coupée au lieu d'un message clair

## Lot 2 — Copilot / IA gratuite
- [x] Quota par élève et par jour + taille maximale des messages
- [x] Fichier de cours trop long pour Groq → limite adaptée + message clair
- [x] Historique de conversation coupé proprement (plus de blocage après de longues sessions)
- [x] Suppressions par l'IA : bouton « Confirmer » obligatoire, identifiant exact
- [x] Un « oui » qui déclenche une suggestion au lieu de répondre à l'IA
- [x] Faux jetons de connexion : limite par IP, mémoire qui grossit
- [x] Mode local qui ouvre l'IA sans connexion en production

## Lot 3 — Synchronisation (ne jamais perdre de travail)
- [x] Une ligne refusée bloque toute la synchro de l'appareil
- [x] Un appareil en retard écrase les notes plus récentes (+ compteur de concentration) (SQL à appliquer : `2026-10-14_synchro_version_recente.sql`)
- [x] Plus de 1000 éléments : une partie disparaît
- [x] Rechargement en plein milieu d'une modification qui la défait
- [x] Deux onglets hors ligne qui s'écrasent
- [x] Restauration d'une sauvegarde qui supprime définitivement
- [x] Images dans les notes qui remplissent la mémoire du navigateur (alerte claire ; stocker les images en ligne : plus tard)

## Lot 4 — Fichiers et stockage
- [x] Fichiers restants après suppression de compte / de groupe (RGPD)
- [x] Taille maximale par fichier et quota par élève (SQL à appliquer : `2026-10-14b_stockage_limites.sql`)
- [x] Envoi de plusieurs fichiers interrompu : fichiers invisibles qui restent
- [x] Lien de partage encore valable 30 jours après suppression

## Lot 5 — Serveur de production
- [x] Écran blanc après une mise à jour du site (erreur 404 + écran « Recharger »)
- [x] Compression, en-têtes de sécurité, URL malformée, journal d'erreurs
- [x] Écran blanc pendant le chargement, Drive et Agenda chargés à la demande

## Lot 6 — Groupes et agenda
- [x] Temps réel non filtré et comptage toutes les 30 s trop coûteux
- [x] Démarrage / arrêt des pastilles qui double le comptage
- [x] .ics : cours annulés encore affichés, réimport qui ne met rien à jour

## Lot 7 — Tests et ménage
- [x] Tests automatiques (dates, .ics, adaptateur IA, synchro) + vérification à chaque push
- [x] Code en double / jamais utilisé, dépendances inutiles, `npm audit fix`
- [x] Calcul lent après un gros import .ics
- [x] README à jour, `graphify-out/` dans `.gitignore`, Node 22

## Lot 8 — Ce qui manque pour lancer
- [x] Application installable sur téléphone (manifeste, icônes)
- [x] Référencement : description, `robots.txt`, `sitemap.xml` (variable `SITE_URL`)
- [x] Clé de secours 2FA (téléphone perdu = compte bloqué)
- [x] Suivi des erreurs en production (journal du serveur, sans service tiers)
- [x] Pages légales (mentions, confidentialité, conditions) + case à cocher à l'inscription

## À faire par toi avant d'ouvrir au public
- [x] Appliquer dans Supabase les SQL `2026-10-14_synchro_version_recente.sql` et `2026-10-14b_stockage_limites.sql`
- [ ] (au dernier moment) Compléter les passages [À COMPLÉTER] de `src/pages/legal/LegalPage.tsx` (éditeur, contact, hébergeur, fournisseur d'IA)
- [x] Supprimer le compte de test `test-sync-…` resté dans Supabase (Authentication › Users)
- [ ] (au dernier moment) Révoquer le jeton Supabase (sbp_…) et régénérer la clé Groq (passés dans le chat)
- [x] Offre Supabase : gratuite pour l'instant (1 Go pour tout le site)
- [ ] (avant l'ouverture au public) Remettre un quota par élève : `QUOTA` dans `src/lib/blobStore.ts` + `storage_quota()` en SQL (désactivés pour l'usage perso)
- [ ] (avant l'ouverture au public) Choisir une IA avec un plus gros quota (`AI_PROVIDER`, `AI_DAILY_QUESTIONS`, `AI_DAILY_BUDGET`)
- [ ] (avant l'ouverture au public) Vérifier le nom « Kompaly » : marque sur data.inpi.fr et nom de domaine (kompaly.app, getkompa.fr…)
- [ ] Supabase › Authentication › Emails : remplacer « COP-PILOT » par « Kompaly » dans les e-mails (confirmation, mot de passe)
- [ ] (avant l'ouverture au public) « Enregistrer » : vérifier la clé de transcription (`TRANSCRIBE_API_KEY`, ou la clé Groq de l'IA), les limites `TRANSCRIBE_DAILY_MINUTES` / `TRANSCRIBE_SITE_MINUTES` (Groq gratuit : environ 8 h de son par jour pour tout le site) et que la « zéro conservation » de Groq couvre aussi l'audio (promis dans la page confidentialité)

## Plus tard (idées validées)
- [ ] Connexion par Face ID / empreinte digitale sur les appareils qui le permettent (clés d'accès « passkeys », WebAuthn)
- [x] Indicateur d'import de fichiers (Drive, groupes, autres espaces) : montrer que l'envoi est en cours et qu'il avance
- [ ] Bouton « Retour » du téléphone qui ferme la fenêtre ouverte au lieu de quitter la page (essai fait le 22/10, mis de côté : il fallait modifier l'historique du navigateur pour tout le site, trop risqué avant le lancement)
- [ ] Synchro plus légère : ne relire que ce qui a changé (`updated_at`) au lieu de tout le compte toutes les 2 min et à chaque retour sur l'onglet (lib/cloudSync.ts refresh). À tester sur deux appareils
- [ ] Ouverture plus rapide pour un habitué : afficher la copie de l'appareil tout de suite et relire le compte en arrière-plan (store/session.ts, `pushLeftovers` puis `pullAll`). Risque : modifications faites pendant la relecture, à tester sur deux appareils
- [ ] Landing plus légère pour un visiteur : ne charger Supabase (≈65 Ko) que s'il a une session ou va sur /connexion (lib/supabase.ts)
- [ ] Enregistrer un cours : bouton Pause, chrono arrêté pendant la pause
