// Affichage Pro: texts without emoji (Kompaly's words, the toasts). The words stay; signs that mean something in a
// sentence (★ « important », arrows, ⌘) are not emoji and stay too.

/** One emoji: a picture (😄, ⭐, 📁) or a sign drawn as one (⚠️), with its skin tone, joined parts (👩‍💻) or keycap. */
const EMOJI = /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️|\p{Regional_Indicator})(?:\p{Emoji_Modifier}|️|⃣|‍\p{Extended_Pictographic}️?)*/gu;

/** The text without its emoji: one between two sentences becomes their full stop (« Salut 👋 Ça va » → « Salut. Ça va »). */
export function sober(text: string): string {
  if (!/[\p{Emoji_Presentation}\p{Regional_Indicator}️]/u.test(text)) return text;
  return text
    .replace(new RegExp(`(\\p{L})[ \\t]*(?:${EMOJI.source})+[ \\t]+(?=\\p{Lu})`, 'gu'), '$1. ')
    .replace(EMOJI, '')
    .replace(/️/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/gm, '');
}
