import { describe, expect, it } from 'vitest';
import { sober } from '../src/lib/sober';

describe('sober (Affichage Pro: no emoji)', () => {
  it('keeps the words, an emoji between two sentences becomes a full stop', () => {
    expect(sober('Salut ! 👋 Je passais par là, tout roule ?')).toBe('Salut ! Je passais par là, tout roule ?');
    expect(sober('Coucou 😄 Qu’est-ce que je peux faire pour toi ?')).toBe('Coucou. Qu’est-ce que je peux faire pour toi ?');
    expect(sober('Respire 🌬️ Fais d’abord la plus petite tâche.')).toBe('Respire. Fais d’abord la plus petite tâche.');
    expect(sober('Avec plaisir 😎')).toBe('Avec plaisir');
    expect(sober('⭐ Moment marqué')).toBe('Moment marqué');
    expect(sober('⚠️ Écoute arrêtée')).toBe('Écoute arrêtée');
  });
  it('cleans each line of a list', () => {
    expect(sober('Petit bilan 📊\n📁 Fichiers : 2 dossiers\n📝 Notes : 3 notes')).toBe('Petit bilan\nFichiers : 2 dossiers\nNotes : 3 notes');
    expect(sober('Une équipe 👩‍💻 au top')).toBe('Une équipe au top');
  });
  it('leaves signs that are part of the sentence', () => {
    const text = 'Marque-le ★ dans le calendrier → ⌘J, 25 °C, « oui » © 2026';
    expect(sober(text)).toBe(text);
    expect(sober('Rien à enlever.')).toBe('Rien à enlever.');
  });
  // The assistant's warning after a refused save (copilot/claudeBrain): no emoji in Affichage Pro.
  it('strips the warning sign before « Pas enregistré en ligne »', () => {
    expect(sober('C’est noté.\n\n⚠️ Pas enregistré en ligne : le serveur l’a refusé.')).toBe('C’est noté.\n\nPas enregistré en ligne : le serveur l’a refusé.');
    expect(sober('⚠ Pas enregistré en ligne.')).toBe('Pas enregistré en ligne.');
  });
});
