import { describe, expect, it } from 'vitest';
import { afterLink, parseEmailLink } from '../src/lib/emailLink';

describe('parseEmailLink', () => {
  it('reads the code and the kind of our e-mail links', () => {
    expect(parseEmailLink('?token_hash=pkce_abc123DEF456&type=signup')).toEqual({ tokenHash: 'pkce_abc123DEF456', type: 'signup' });
    expect(parseEmailLink('?type=recovery&token_hash=0123456789abcdef')).toEqual({ tokenHash: '0123456789abcdef', type: 'recovery' });
  });
  it('refuses anything else', () => {
    expect(parseEmailLink('')).toBeNull();
    expect(parseEmailLink('?token_hash=abc&type=signup')).toBeNull(); // too short
    expect(parseEmailLink('?token_hash=0123456789abcdef&type=admin')).toBeNull();
    expect(parseEmailLink('?token_hash=<script>alert(1)</script>&type=signup')).toBeNull();
  });
  it('sends each kind of link to the right page', () => {
    expect(afterLink('recovery')).toBe('/reinitialisation');
    expect(afterLink('email_change')).toBe('/profil?onglet=compte');
    expect(afterLink('signup')).toBeNull();
  });
});
