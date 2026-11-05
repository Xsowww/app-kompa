# E-mails Kompaly pour Supabase

Six modèles aux couleurs de Kompaly, en français :

| Fichier | Modèle Supabase | Sujet |
|---|---|---|
| `confirmation.html` | Confirm signup | Confirme ton adresse e-mail · Kompaly |
| `recovery.html` | Reset password | Réinitialise ton mot de passe · Kompaly |
| `magic_link.html` | Magic link | Ton lien de connexion · Kompaly |
| `email_change.html` | Change email address | Confirme ta nouvelle adresse · Kompaly |
| `invite.html` | Invite user | Tu es invité sur Kompaly |
| `reauthentication.html` | Reauthentication | Ton code de confirmation · Kompaly |

**Prérequis : un service d’envoi personnalisé.** Sur l’offre gratuite, Supabase refuse de modifier les
modèles tant que le projet utilise son service d’envoi par défaut. Configure d’abord Authentication ›
SMTP Settings (Resend, Brevo, Gmail…), puis installe les modèles.

Le logo est l’icône du site (`{{ .SiteURL }}/icon-192.png`) et **les liens des e-mails pointent vers
`{{ .SiteURL }}/confirmer`** (plus d’adresse en `supabase.co` : la page de Kompaly vérifie le lien elle-même).
Règle donc d’abord **Site URL** dans Authentication › URL Configuration sur `https://kompaly.com`.

## Option 1 : en une commande

1. Crée un jeton sur https://supabase.com/dashboard/account/tokens
2. Dans le dossier du projet :
   ```
   SUPABASE_ACCESS_TOKEN=sbp_ton_jeton node supabase/emails/appliquer.mjs
   ```
3. Révoque le jeton juste après.

## Option 2 : à la main

Supabase › Authentication › Emails › Templates. Pour chaque modèle du tableau : colle le sujet,
puis tout le contenu du fichier `.html` dans « Message body », et enregistre.
