// The links of our e-mails (sign-up, password, magic link, new address, invitation) point to kompaly.com/confirmer
// instead of a supabase.co address: the page checks the link's code itself (supabase.auth.verifyOtp).
// Pure: tested in tests/emailLink.test.ts.

export type EmailLinkType = 'signup' | 'email' | 'magiclink' | 'invite' | 'recovery' | 'email_change';

const TYPES: EmailLinkType[] = ['signup', 'email', 'magiclink', 'invite', 'recovery', 'email_change'];

/** The code and the kind of link read from the address (`?token_hash=…&type=…`), or null when it isn't one of ours. */
export function parseEmailLink(search: string): { tokenHash: string; type: EmailLinkType } | null {
  const q = new URLSearchParams(search);
  const tokenHash = (q.get('token_hash') ?? '').trim();
  const type = q.get('type') as EmailLinkType | null;
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(tokenHash) || !type || !TYPES.includes(type)) return null;
  return { tokenHash, type };
}

/** Where the person goes once the link is accepted (sign-up and the like: the usual place after signing in). */
export const afterLink = (type: EmailLinkType): string | null =>
  type === 'recovery' ? '/reinitialisation' : type === 'email_change' ? '/profil?onglet=compte' : null;
