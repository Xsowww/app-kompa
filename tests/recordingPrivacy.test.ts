import { describe, expect, it } from 'vitest';
import { productSheet } from '../server/copilotPrompt.mjs';

// Kompaly asked whether a recording stays private (visitors' test: « je ne peux pas le garantir à 100 % », and a
// provider named without a word of explanation): the privacy page's facts, said plainly, with or without the AI.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
  document: { documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} } }, querySelector: () => null },
});
const { localReply } = await import('../src/copilot/localBrain');

describe('Kompaly sans IA : la confidentialité des enregistrements', () => {
  for (const q of ['Mes enregistrements sont-ils privés ?', 'Est-ce que le son de mon cours est gardé ?', 'Qui peut écouter mes enregistrements ?', 'la transcription est confidentielle ?', 'Mes cours enregistrés sont en sécurité ?']) {
    it(`« ${q} »`, () => {
      const r = localReply(q);
      expect(r.text).toContain('Le son n’est jamais gardé');
      expect(r.text).toContain('toi seul les vois');
      expect(r.text).toContain('aux États-Unis');
      expect(r.text).not.toMatch(/Groq|garantir|100 %/);
      expect(r.links?.[0]?.to).toBe('/confidentialite#enregistrer');
    });
  }

  it('« Comment enregistrer mon cours ? » reste l’aide de la page Enregistrer', () => {
    const r = localReply('Comment enregistrer mon cours ?');
    expect(r.text).not.toContain('jamais gardé');
    expect(r.links?.[0]?.to).toBe('/enregistrer');
  });
});

describe('Kompaly avec l’IA : la fiche produit', () => {
  const sheet = productSheet({ provider: { id: 'anthropic', label: 'Claude' } });
  it('dit que le son n’est jamais gardé, où il part et qui voit le texte, sans douter', () => {
    const line = /- Enregistrements et vie privée[^\n]*/.exec(sheet)![0];
    expect(line).toContain("le son n'est jamais gardé");
    expect(line).toContain('aux États-Unis');
    expect(line).toContain('lui seul les voit');
    expect(line).toContain('sans « je ne peux pas garantir »');
    // The provider is named only when asked which.
    expect(line).toMatch(/Ne nomme ce service \(Groq\) que si on te demande lequel/);
    expect(sheet).not.toMatch(/écrit en texte par Groq/);
  });
});
