import { create } from 'zustand';
import { supabase } from './supabase';
import { t } from '../i18n';

// Avis / bugs envoyés depuis l'appli, et signalements de contenus dans les groupes
// (tables feedback et reports, supabase/migrations/2026-10-16b_signalements_avis.sql).

export const CONTACT = 'contact@kompaly.com';

export type FeedbackKind = 'idea' | 'bug';

export const REPORT_REASONS = [
  { value: 'illegal', label: t('Contenu illégal') },
  { value: 'hate', label: t('Harcèlement, haine ou violence') },
  { value: 'rights', label: t('Atteinte au droit d’auteur ou à la vie privée') },
  { value: 'spam', label: t('Spam ou arnaque') },
  { value: 'other', label: t('Autre raison') },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]['value'];
export type ReportKind = 'note' | 'file' | 'event';

/** « Donner mon avis » : la fenêtre s'ouvre de n'importe où (menu, profil). */
export const useFeedback = create<{ open: FeedbackKind | null }>(() => ({ open: null }));
export const openFeedback = (kind: FeedbackKind = 'idea') => useFeedback.setState({ open: kind });

function sendError(e: unknown): Error {
  const msg = String((e as { message?: string })?.message ?? e ?? '');
  if (/too many/i.test(msg)) return new Error(t('Tu en as déjà envoyé beaucoup : réessaie un peu plus tard.'));
  if (/mfa required/i.test(msg)) return new Error(t('Confirme d’abord ta connexion avec le code de ton téléphone.'));
  if (/fetch|network/i.test(msg)) return new Error(t('Pas de connexion. Réessaie dans un instant.'));
  // Table or function missing (migration not applied yet), refused…: the e-mail always works.
  return new Error(t('Envoi impossible pour l’instant. Tu peux écrire à {email}.', { email: CONTACT }));
}

/** The page and the kind of device, to find a bug again (no content of the page). */
function device() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'autre système';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'autre navigateur';
  return `${browser} · ${os} · ${window.innerWidth}×${window.innerHeight}${matchMedia('(display-mode: standalone)').matches ? ' · appli installée' : ''}`;
}

/** Sends the message; in local mode (no server) opens the mail app instead. */
export async function sendFeedback(kind: FeedbackKind, message: string): Promise<'sent' | 'mail'> {
  const text = message.trim().slice(0, 4000);
  if (!supabase) {
    const subject = kind === 'bug' ? t('Bug sur Kompaly') : t('Mon avis sur Kompaly');
    location.href = `mailto:${CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${text}\n\n— ${location.pathname} · ${device()}`)}`;
    return 'mail';
  }
  const { data } = await supabase.auth.getSession();
  const { error } = await supabase.from('feedback').insert({ user_id: data.session?.user.id, kind, message: text, page: location.pathname.slice(0, 300), device: device().slice(0, 300) });
  if (error) throw sendError(error);
  return 'sent';
}

export async function reportGroupItem(kind: ReportKind, itemId: string, reason: ReportReason, message: string) {
  if (!supabase) throw new Error(t('Les signalements nécessitent la version en ligne.'));
  const { error } = await supabase.rpc('report_group_item', { p_kind: kind, p_item: itemId, p_reason: reason, p_message: message.trim() || null });
  if (error) throw sendError(error);
}
