/** Titles and initials before a first name (« M. », « Dr », « Mme »…): skipped by the greeting. */
const TITLE = /^(m|mme|mlle|mr|mrs|ms|dr|pr|me|[a-zà-ÿ]\.)\.?$/i;

/**
 * The first name to greet with: « Prénom » also takes a full name (« Dylan Test-Visiteur »), and the home page said
 * all of it, on two lines. The first word (a compound « Jean-Pierre » stays whole), after a title or an initial.
 */
export function firstName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.find(w => !TITLE.test(w)) ?? words[0] ?? '';
}
