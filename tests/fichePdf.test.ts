import { describe, expect, it } from 'vitest';
import { markdownToPdf, pdfSafe } from '../src/lib/fichePdf';

describe('fiche PDF', () => {
  it('keeps French, writes the other signs in words', () => {
    expect(pdfSafe('Été « œuvre » — 3 €')).toBe('Été « oeuvre » — 3 €');
    expect(pdfSafe('x → y ≤ π 🙂')).toBe('x -> y <= pi ');
  });
  it('makes a real PDF, several pages when long', async () => {
    const md = `# Photosynthèse\n\n## Définition\n\n**La photosynthèse** transforme la lumière en *énergie*.\n\n- point un\n  - sous-point\n1. étape\n2. étape\n\n> remarque\n\n---\n\n${'Un long paragraphe qui doit passer à la ligne plusieurs fois. '.repeat(200)}`;
    const blob = await markdownToPdf(md, { title: 'Photosynthèse' });
    const text = new TextDecoder('latin1').decode(await blob.arrayBuffer());
    expect(text.startsWith('%PDF-')).toBe(true);
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });
});
