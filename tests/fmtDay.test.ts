import { describe, expect, it } from 'vitest';
import { fmtDay } from '../src/lib/dates';

describe('fmtDay', () => {
  const thisYear = new Date().getFullYear();
  it('this year: the pattern as it is', () => {
    expect(fmtDay(new Date(thisYear, 5, 2), 'EEEE d')).not.toMatch(/\d{4}/);
  });
  it('another year: the year, and the month when the pattern had none (never « lundi 7 2027 »)', () => {
    const d = new Date(thisYear + 1, 0, 7);
    expect(fmtDay(d, 'EEEE d')).toMatch(new RegExp(`^\\S+ 7 janv\\. ${thisYear + 1}$`));
    expect(fmtDay(d, 'EEEE d MMMM')).toMatch(new RegExp(`7 janvier ${thisYear + 1}$`));
  });
});
