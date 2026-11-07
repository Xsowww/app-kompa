import { describe, expect, it } from 'vitest';
import { typeTime } from '../src/lib/timeTyping';

/** Types `keys` one at a time, as in the field. */
const typed = (keys: string, from = '') => [...keys].reduce((text, k) => typeTime(text + k, text), from);

describe('typing a time', () => {
  it('puts the « h » after the hours and goes on to the minutes', () => {
    expect(typed('1')).toBe('1');
    expect(typed('14')).toBe('14h');
    expect(typed('1430')).toBe('14h30');
    expect(typed('0930')).toBe('09h30');
  });
  it('one digit that can only be an hour alone is followed by « h » at once', () => {
    expect(typed('9')).toBe('9h');
    expect(typed('930')).toBe('9h30');
  });
  it('never more than two digits of minutes', () => {
    expect(typed('143059')).toBe('14h30');
    expect(typed('9h7')).toBe('9h07');
  });
  it('erases naturally: the « h », then the hours', () => {
    expect(typeTime('14', '14h')).toBe('14');
    expect(typeTime('1', '14')).toBe('1');
    expect(typed('3', '14')).toBe('14h3');
  });
  it('a pasted time is read whole', () => {
    for (const [paste, out] of [['9h30', '9h30'], ['09:30', '09h30'], ['930', '9h30'], ['14 h 05', '14h05'], ['1430', '14h30']]) expect(typeTime(paste)).toBe(out);
    expect(typeTime('')).toBe('');
    expect(typeTime('abc')).toBe('');
  });
});
