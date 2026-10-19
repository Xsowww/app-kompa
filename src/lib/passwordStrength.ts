// How strong a new password looks, for the bar under the field. A guide only: the rule that blocks
// is still « 8 characters, letters and digits » (AuthPage, Profile).

const COMMON = ['password', 'motdepasse', 'azerty', 'qwerty', 'soleil', 'bonjour', 'kompaly', 'admin', 'welcome', 'loveyou', 'iloveyou', 'abc123', 'football', 'marseille', 'doudou', 'chouchou'];

/** A run of 4+ same or following characters: « aaaa », « 1234 », « abcd », « 4321 ». */
function hasRun(p: string): boolean {
  const s = p.toLowerCase();
  for (let i = 0; i + 3 < s.length; i++) {
    const d = [1, 2, 3].map(k => s.charCodeAt(i + k) - s.charCodeAt(i + k - 1));
    if (d.every(x => x === d[0]) && Math.abs(d[0]) <= 1) return true;
  }
  return false;
}

/** 0: nothing typed, then 1 (weak) to 4 (strong). */
export function passwordStrength(password: string, avoid: readonly string[] = []): 0 | 1 | 2 | 3 | 4 {
  const p = password;
  if (!p) return 0;
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\d/, /[^\p{L}\d]/u].filter(r => r.test(p)).length;
  let score = (p.length >= 8 ? 1 : 0) + (p.length >= 12 ? 1 : 0) + (p.length >= 16 ? 1 : 0) + (classes >= 3 ? 1 : 0) + (classes >= 4 ? 1 : 0);
  const low = p.toLowerCase();
  const weak =
    p.length < 8 ||
    !/\p{L}/u.test(p) ||
    !/\d/.test(p) ||
    COMMON.some(w => low.includes(w)) ||
    avoid.some(w => w.length >= 3 && low.includes(w.toLowerCase())) ||
    (hasRun(p) && p.length < 14);
  if (weak) score = Math.min(score, 1);
  return Math.max(1, Math.min(4, score)) as 1 | 2 | 3 | 4;
}
