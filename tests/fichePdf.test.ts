import { describe, expect, it } from 'vitest';
import { markdownToPdf, pdfSafe } from '../src/lib/fichePdf';

describe('fiche PDF', () => {
  it('keeps French, writes the other signs in words', () => {
    expect(pdfSafe('Été « œuvre » — 3 €')).toBe('Été « oeuvre » — 3 €');
    expect(pdfSafe('x → y ≤ π 🙂')).toBe('x -> y <= pi ');
  });
  it('keeps exponents, Greek letters and math signs readable, never drops an unknown sign', () => {
    expect(pdfSafe('Ca²⁺, SO₄²⁻, 10⁻³ m, x⁻¹, x², xⁿ⁺¹')).toBe('Ca^2+, SO4^2-, 10^-3 m, x^-1, x², x^(n+1)');
    expect(pdfSafe('η = 0,8 ; Φ = 5 ; ∂f/∂x ; ∆E')).toBe('êta = 0,8 ; Phi = 5 ; df/dx ; DeltaE');
    expect(pdfSafe('A ∩ B, A ∪ B, x ∈ ℝ, ⅓ + ⅔ = 1')).toBe('A inter B, A union B, x appartient à R, 1/3 + 2/3 = 1');
    expect(pdfSafe('a ≡ b, f′ ; 中 ✅ ⚠️ 👍🏽 🇫🇷 x̄')).toBe("a == b, f' ; ? x");
  });
  it('makes a real PDF, several pages when long', async () => {
    const md = `# Photosynthèse\n\n## Définition\n\n**La photosynthèse** transforme la lumière en *énergie*.\n\n- point un\n  - sous-point\n1. étape\n2. étape\n\n> remarque\n\n---\n\n${'Un long paragraphe qui doit passer à la ligne plusieurs fois. '.repeat(200)}`;
    const blob = await markdownToPdf(md, { title: 'Photosynthèse' });
    const text = new TextDecoder('latin1').decode(await blob.arrayBuffer());
    expect(text.startsWith('%PDF-')).toBe(true);
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });
});
