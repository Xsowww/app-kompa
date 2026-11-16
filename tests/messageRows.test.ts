// Le point du matin de Kompaly, lu d'un coup d'œil : un titre puis une ligne par sujet.
import { describe, expect, it } from 'vitest';
import { messageRows } from '../src/lib/messageRows';

describe('message en lignes', () => {
  it('le point du matin', () => {
    const m = messageRows('Salut Léo ! Voici ta journée :\nAujourd’hui : rien au calendrier.\nÀ faire : Poster Instagram.\nProchain examen : aucun à l’horizon.');
    expect(m).toEqual({
      head: 'Salut Léo ! Voici ta journée',
      rows: [
        { label: 'Aujourd’hui', value: 'Rien au calendrier' },
        { label: 'À faire', value: 'Poster Instagram' },
        { label: 'Prochain examen', value: 'Aucun à l’horizon' },
      ],
    });
  });
  it('un message ordinaire reste du texte', () => {
    expect(messageRows('Bonjour ! Je suis Kompaly, ton assistant.')).toBeNull();
    expect(messageRows('Ligne 1\nUne phrase sans deux-points\nEncore une')).toBeNull();
  });
});
