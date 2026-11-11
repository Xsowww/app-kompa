import { afterEach, describe, expect, it } from 'vitest';
import { setDictForTests, t } from '../src/i18n';
import { relativeTime, relativeWhen } from '../src/lib/utils';
import en from '../src/i18n/en.json';
import it_ from '../src/i18n/it.json';

afterEach(() => setDictForTests('fr', {}));

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

describe('« modifié … » dans une phrase', () => {
  it('en français : « il y a 4 min », « hier », puis « le 3 oct. »', () => {
    expect(t('modifié {time}', { time: relativeWhen(ago(4 * MIN)) })).toBe('modifié il y a 4 min');
    expect(t('modifiée {time}', { time: relativeWhen(ago(DAY)) })).toBe('modifiée hier');
    // Une date prend son « le » : « modifiée 3 oct. » n’est pas français.
    expect(t('modifiée {time}', { time: relativeWhen(ago(30 * DAY)) })).toMatch(/^modifiée le \d{1,2} \S+$/);
    // Seule (liste, colonne), la date reste nue.
    expect(relativeTime(ago(30 * DAY))).toMatch(/^\d{1,2} \S+$/);
  });

  it('en anglais et en italien : plus de « modified on 4 min ago »', () => {
    setDictForTests('en', en);
    expect(t('modifié {time}', { time: relativeWhen(ago(4 * MIN)) })).toBe('modified 4 min ago');
    expect(t('modifié {time}', { time: relativeWhen(ago(30 * DAY)) })).toMatch(/^modified on \d{1,2} \S+$/);
    setDictForTests('it', it_);
    expect(t('modifié {time}', { time: relativeWhen(ago(4 * MIN)) })).toBe('modificato 4 min fa');
  });
});
