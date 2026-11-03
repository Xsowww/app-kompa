// Invitations to a group (its 6-character code, or its link /groupes?rejoindre=CODE) and to a shared calendar
// (its link /agendas?invitation=<64 hex>, never a code): the message sent, and what is pasted back in « Rejoindre ».
import { t } from '../i18n';

type Kind = 'groupe' | 'agenda';

export const inviteLink = (kind: Kind, secret: string, origin: string) =>
  kind === 'agenda' ? `${origin}/agendas?invitation=${secret}` : `${origin}/groupes?rejoindre=${secret}`;

/** The ready-to-send message: the link, and a group's code too (typed by hand on another device). */
export const inviteText = (g: { kind: Kind; name: string }, secret: string, origin: string) =>
  g.kind === 'agenda'
    ? t('Rejoins l’agenda partagé « {name} » sur Kompaly : {link}', { name: g.name, link: inviteLink('agenda', secret, origin) })
    : t('Rejoins « {name} » sur Kompaly : {link} (code {code})', { name: g.name, link: inviteLink('groupe', secret, origin), code: secret });

/**
 * What was pasted or typed in « Rejoindre »: a shared calendar's link (or its bare token), a group's link, its code,
 * or a whole message holding one of them. `secret` empty: an agenda link cut short (asked again, whole).
 */
export function parseInvite(text: string): { kind: Kind; secret: string } | null {
  const token = /invitation=([0-9a-f]{64})(?![0-9a-f])/i.exec(text)?.[1] ?? /^\s*([0-9a-f]{64})\s*$/i.exec(text)?.[1];
  if (token) return { kind: 'agenda', secret: token.toLowerCase() };
  if (/invitation=/i.test(text)) return { kind: 'agenda', secret: '' };
  // A message pasted whole (« … avec le code ZZ9Y8X sur Kompaly »): the word after « code ».
  const code = (/rejoindre=([A-Za-z0-9]{6})(?![A-Za-z0-9])/i.exec(text)?.[1] ?? /\bcode\s*[:：]?\s*([A-Za-z0-9]{6})\b/i.exec(text)?.[1] ?? text)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(-6);
  return code.length === 6 ? { kind: 'groupe', secret: code } : null;
}
