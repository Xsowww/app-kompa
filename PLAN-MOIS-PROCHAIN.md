# Plan validé pour le mois prochain (novembre 2026)

Validé le 26 octobre 2026 avec le simulateur Kompaly. Référence unique : les artefacts « Lancement Kompaly »,
« Services de Kompaly » et « Simulateur Kompaly » reprennent ce même plan.

## Les offres

| Service | Offre | Prévu par mois | Notes |
|---|---|---|---|
| Serveur | Render Free + UptimeRobot (sonde toutes les 5 min sur `/api/sante`) + carte enregistrée | 0 € | Un seul service gratuit chez Render (744 h sur 750). La carte paie le dépassement des 5 Go envoyés (0,15 $/Go) au lieu d'une suspension |
| Base et fichiers | Supabase Pro, plafond de dépense activé | 25 $ (≈ 23 €) | Sauvegarde chaque jour, 100 Go de fichiers, jamais en pause |
| Kompaly + enregistrement | Groq Developer : `openai/gpt-oss-120b` et `whisper-large-v3-turbo` (un seul compte) | ≈ 27 $ (≈ 25 €) | Limite de dépense : 55 $ par mois |
| Photo → fiche | Gemini payant (même clé `GEMINI_API_KEY`) | ≈ 0,30 € | Obligatoire pour des utilisateurs en Europe ; les photos ne sont plus réutilisées par Google |
| E-mails | Resend gratuit | 0 € | 100 par jour, 3 000 par mois |
| Marque | INPI, classes 9, 41 et 42 | 270 € une fois | 190 € la 1re classe + 40 € par classe |

**Total : ≈ 49 € par mois prévus, 75 € au maximum** (plafonds de dépense), plus 270 € une seule fois.

Usage prévu (simulateur) : 30 utilisateurs actifs, 22 jours d'usage, 20 questions par personne et par jour,
5 % enregistrent 1 h de cours par jour, 10 % font une fiche photo, audio en FLAC.

## Ce que le plan encaisse au maximum par mois (30 jours)

| Ce qui est consommé | Maximum | Ce qui fixe la limite |
|---|---|---|
| Questions à Kompaly | ≈ 28 000 | Limite de dépense Groq (55 $) ; `AI_DAILY_BUDGET=1500` donne la même chose |
| Questions par personne | 30 par jour | `AI_DAILY_QUESTIONS` (30 par défaut) |
| Heures de cours transcrites | ≈ 225 h (7 h 30 par jour) | `TRANSCRIBE_SITE_MINUTES` (450 par défaut) ; ≈ 0,06 $ l'heure sur la même limite Groq |
| Données envoyées par Render | 5 Go inclus | ≈ 83 h de cours, ou ≈ 89 000 questions, ou ≈ 3 100 fiches ; ensuite 0,15 $/Go |
| Connectés en même temps | ≈ 300 | Processeur de Render Free |
| Fichiers (Supabase) | 100 Go au total | Cumul, 50 Mo max par fichier |
| Données envoyées par Supabase | 250 Go | |
| Base | 8 Go (≈ 50 000 comptes) | |
| Comptes actifs | 100 000 | |
| Connexions en direct | 500 en même temps, 5 millions de messages | |
| E-mails | 100 par jour, 3 000 par mois (≈ 49 inscriptions par jour, ≈ 1 000 par mois) | Resend gratuit ; Supabase : 30 confirmations par heure |
| Photos → fiche | pas de plafond (≈ 220 fiches pour 1 $) | |

Le budget Groq est partagé : questions et heures de cours piochent dans les mêmes 55 $.

## Mise en place, dans l'ordre

1. **Supabase** › Organization › Billing : passer en Pro, laisser le plafond de dépense activé.
2. **Groq** › console.groq.com › Settings › Billing : passer en Developer, carte, limite de dépense 55 $ par mois.
3. **Render** › kompa-app › Environment : ajouter `AI_DAILY_BUDGET=1500`, puis « Save, rebuild and deploy ».
4. **Render** › Workspace › Billing : enregistrer une carte (sinon suspension au-delà de 5 Go envoyés).
5. **Google AI Studio** › la clé Gemini : activer la facturation, et une alerte de budget à 5 $.
6. **UptimeRobot** : vérifier la sonde sur `https://kompaly.com/api/sante` toutes les 5 min.
7. **INPI** : déposer la marque Kompaly en ligne, classes 9, 41 et 42 (270 €).
8. **Vérifier** : `kompaly.com/api/sante` (ia, emails, photo), 3 questions à Kompaly, 1 minute d'enregistrement de cours, 1 fiche photo.

Déjà fait côté code : l'audio des cours part en FLAC (26 octobre), rien d'autre à développer pour ce plan.

## Si l'usage dépasse le plan

- Plus de questions : monter la limite de dépense Groq, `AI_DAILY_BUDGET` et `AI_DAILY_QUESTIONS`.
- Plus de 7 h 30 de cours par jour : `TRANSCRIBE_SITE_MINUTES=1500` dans Render.
- Plus de 49 inscriptions par jour : Resend Pro (20 $/mois) et relever « e-mails par heure » dans Supabase › Authentication › Rate limits.
- Fichiers proches de 100 Go : remettre un quota par compte (SQL prêt à préparer).
