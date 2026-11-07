// A time typed in the time picker (components/Pickers): « 14 » becomes « 14h » and what follows goes to the minutes,
// as on a phone's clock (typed digits used to pile up in the hours: « 14305 »).

/**
 * The text of the field after a change: the hours (two digits, or one when it can't be followed by another: « 9 »),
 * then « h » by itself and the minutes (two digits at most). Pasted « 9h30 », « 09:30 », « 930 » or « 1430 » give
 * « 9h30 », « 09h30 », « 9h30 », « 14h30 ». `before`: the text before the change; when the change removed something
 * (backspace) it is kept as typed, so that the « h » can be erased like any letter.
 */
export function typeTime(text: string, before = ''): string {
  const s = text.trim().toLowerCase();
  if (!s) return '';
  // Erasing: as typed (only what can't be part of a time goes).
  if (s.length < before.trim().length && before.trim().toLowerCase().startsWith(s)) return s.replace(/[^\dh:]/g, '');
  const minutes = (m: string) => {
    const d = m.replace(/\D/g, '').slice(0, 2);
    // « 9h7 »: 7 can't start a number of minutes, it is 07.
    return d && d[0] > '5' ? `0${d[0]}` : d;
  };
  // Hours and minutes already apart (« 9h30 », « 09:30 », « 9 h », « 9.30 »).
  const apart = /^(\d{1,2})\s*[h:.\s]\s*(.*)$/.exec(s);
  if (apart) return `${apart[1]}h${minutes(apart[2])}`;
  const d = s.replace(/\D/g, '').slice(0, 4);
  if (!d) return '';
  // One digit that can only be an hour alone (3 to 9), or a 2 before 4 to 9 (« 25 » is 2h5…): the hours are done.
  if (d[0] > '2') return `${d[0]}h${minutes(d.slice(1))}`;
  if (d.length === 1) return d;
  if (d[0] === '2' && d[1] > '3') return `2h${minutes(d.slice(1))}`;
  return `${d.slice(0, 2)}h${minutes(d.slice(2))}`;
}
