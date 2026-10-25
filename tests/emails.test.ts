import { describe, expect, it } from 'vitest';
import { buildEmail } from '../server/emails.mjs';

describe('e-mails de bienvenue et de conseils', () => {
  it('in the account’s language, with its first name, escaped', () => {
    const w = buildEmail('welcome', { name: 'Lina <b>Dupont</b>', lang: 'fr' });
    expect(w.subject).toBe('Bienvenue sur Kompaly, Lina');
    expect(w.html).toContain('Bonjour Lina,');
    expect(w.html).not.toContain('<b>Dupont');
    expect(w.text).toContain('1. Ton emploi du temps');
    const en = buildEmail('tips', { name: '', lang: 'en' });
    expect(en.subject).toBe('three ideas for Kompaly');
    expect(en.unsubscribe).toContain('/profil?onglet=notifications');
    expect(buildEmail('welcome', { name: 'Ana', lang: 'xx' }).subject).toBe('Bienvenue sur Kompaly, Ana');
  });
});
