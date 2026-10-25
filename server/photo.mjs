// « Photo → fiche » : one to four photos (handwritten notes, a printed page, a whiteboard…) read by an AI that sees
// images, written back as a clean revision sheet in Markdown. The page then makes the PDF. Photos are never stored.
//
// Who reads them: VISION_API_KEY (+ VISION_BASE_URL, VISION_MODEL; any OpenAI-compatible service, Gemini by default),
// else GEMINI_API_KEY (free key from Google AI Studio), else the site's AI when it is Claude or Gemini.

import Anthropic from '@anthropic-ai/sdk';
import { callOnce, resolveProvider, ProviderError } from './aiProviders.mjs';
import { languageLine } from './copilotPrompt.mjs';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai/';
// The latest Flash, whatever its number: no change needed when Google retires a version.
const GEMINI_MODEL = 'gemini-flash-latest';

export const MAX_PHOTOS = 4;
const MAX_PHOTO = 2_800_000; // characters of one data URL (the page sends ~0.5 Mo JPEGs)
export const MAX_PHOTO_BODY = MAX_PHOTOS * MAX_PHOTO + 10_000;

export function resolveVision(env = process.env) {
  const v = name => String(env[name] ?? '').trim();
  if (v('VISION_API_KEY')) return { kind: 'openai', apiKey: v('VISION_API_KEY'), baseUrl: v('VISION_BASE_URL') || GEMINI, model: v('VISION_MODEL') || GEMINI_MODEL };
  if (v('GEMINI_API_KEY')) return { kind: 'openai', apiKey: v('GEMINI_API_KEY'), baseUrl: GEMINI, model: v('VISION_MODEL') || GEMINI_MODEL };
  const ai = resolveProvider(env);
  if (ai?.id === 'anthropic') return { kind: 'anthropic', apiKey: ai.apiKey, model: v('VISION_MODEL') || ai.model };
  if (ai?.id === 'gemini') return { kind: 'openai', apiKey: ai.apiKey, baseUrl: ai.baseUrl, model: v('VISION_MODEL') || ai.model };
  return null;
}

const PHOTO = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** The photos sent by the page, or null when one isn't a real picture. */
export function cleanPhotos(list) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_PHOTOS) return null;
  const out = [];
  for (const x of list) {
    const m = typeof x === 'string' && x.length <= MAX_PHOTO ? PHOTO.exec(x) : null;
    if (!m) return null;
    out.push({ url: x, mime: m[1], data: m[2] });
  }
  return out;
}

export const PHOTO_SYSTEM = `Tu reçois une ou plusieurs photos prises par un étudiant ou un professionnel : notes écrites à la main, page de cours ou de livre imprimée, tableau blanc, document, schéma.
Ton travail : en faire une fiche claire et fidèle, en Markdown.
1. Lis TOUT le texte visible, écriture manuscrite comprise, dans l'ordre de lecture (colonnes, flèches, encadrés). Plusieurs photos : ce sont les pages qui se suivent.
2. Recopie-le fidèlement : garde toute l'information (définitions, exemples, chiffres, dates, formules, noms). Corrige seulement les fautes d'orthographe évidentes. Ne résume pas, n'ajoute rien qui ne soit pas sur les photos.
3. Mets en forme : commence par « # <titre> » (le titre écrit, sinon un titre court qui dit le sujet), puis des parties « ## », des listes « - », des listes numérotées si c'est numéroté, **gras** pour ce qui est souligné, encadré ou important. Formules en texte simple (x², √, ≤, →).
4. Un schéma ou un dessin : décris-le en une ou deux lignes en italique, à sa place, avec ses légendes.
5. Un mot illisible : écris [illisible]. Une photo sans texte ni schéma : dis-le en une phrase.
Réponds uniquement avec la fiche, sans phrase avant ni après.`;

/** The last reading, shown by /api/sante to find what goes wrong (never the photo nor the key). */
export const photoStatus = { lastOk: null, lastError: null, detail: null, seconds: null };

// Under Cloudflare's 100 s: past it the page gets Cloudflare's own error instead of ours.
const TIMEOUT_MS = 85_000;

/** Reads the photos. Returns the Markdown sheet. */
export async function readPhotos(vision, photos, lang) {
  const t0 = Date.now();
  try {
    const text = await readOnce(vision, photos, lang);
    Object.assign(photoStatus, { lastOk: new Date().toISOString(), lastError: null, detail: null, seconds: Math.round((Date.now() - t0) / 1000) });
    return text;
  } catch (e) {
    Object.assign(photoStatus, { lastError: `${e?.code ?? e?.status ?? 'erreur'} ${e?.status ?? ''}`.trim(), detail: String(e?.detail ?? e?.message ?? '').slice(0, 200), seconds: Math.round((Date.now() - t0) / 1000) });
    throw e;
  }
}

async function readOnce(vision, photos, lang) {
  const system = PHOTO_SYSTEM + languageLine(lang);
  const ask = photos.length > 1 ? `Voici ${photos.length} photos, dans l'ordre.` : 'Voici la photo.';
  if (vision.kind === 'anthropic') {
    const client = new Anthropic({ apiKey: vision.apiKey });
    const r = await client.messages.create(
      {
        model: vision.model,
        max_tokens: 6000,
        system,
        messages: [{ role: 'user', content: [...photos.map(p => ({ type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } })), { type: 'text', text: ask }] }],
      },
      { timeout: TIMEOUT_MS },
    );
    return r.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  }
  const data = await callOnce(
    vision,
    {
      model: vision.model,
      max_tokens: 6000,
      // Gemini thinks before answering by default: a short think is enough to read a page, and much faster.
      ...(/googleapis\.com/.test(vision.baseUrl) && { reasoning_effort: 'low' }),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: [{ type: 'text', text: ask }, ...photos.map(p => ({ type: 'image_url', image_url: { url: p.url } }))] },
      ],
    },
    TIMEOUT_MS,
  );
  const text = String(data.choices[0]?.message?.content ?? '').trim();
  if (!text) throw new ProviderError('upstream', 502, 'réponse vide');
  // A model that wraps its answer in a code block.
  return text.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i, '$1').trim();
}
