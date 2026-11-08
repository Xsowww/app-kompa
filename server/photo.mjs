// « Photo → fiche » : one to four photos (handwritten notes, a printed page, a whiteboard…) read by an AI that sees
// images, written back as a clean revision sheet in Markdown. The page then makes the PDF. Photos are never stored.
//
// Who reads them: VISION_API_KEY (+ VISION_BASE_URL, VISION_MODEL; any OpenAI-compatible service, Gemini by default),
// else GEMINI_API_KEY (free key from Google AI Studio), else the site's AI when it is Claude or Gemini.

import Anthropic from '@anthropic-ai/sdk';
import { callOnce, mapStatus, resolveProvider, ProviderError } from './aiProviders.mjs';
import { languageLine } from './copilotPrompt.mjs';

const GEMINI_NATIVE = 'https://generativelanguage.googleapis.com/v1beta/models/';
// Tried in order (a model Google has retired answers 404, an overloaded or silent one gives way: the next one is used,
// and one silent for a while gets the next one beside it). 2.5 Flash first, without its « thinking »; then the quick
// « lite » one (the one that starts beside it); the newer ones with as little thinking as they accept.
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-flash-lite-latest'];

export const MAX_PHOTOS = 4;
const MAX_PHOTO = 2_800_000; // characters of one data URL (the page sends ~0.5 Mo JPEGs)
export const MAX_PHOTO_BODY = MAX_PHOTOS * MAX_PHOTO + 10_000;

export function resolveVision(env = process.env) {
  const v = name => String(env[name] ?? '').trim();
  const models = v('VISION_MODEL') ? [v('VISION_MODEL')] : GEMINI_MODELS;
  if (v('VISION_API_KEY') && v('VISION_BASE_URL')) return { kind: 'openai', apiKey: v('VISION_API_KEY'), baseUrl: v('VISION_BASE_URL'), model: v('VISION_MODEL') || GEMINI_MODELS[0] };
  if (v('VISION_API_KEY') || v('GEMINI_API_KEY')) return { kind: 'gemini', apiKey: v('VISION_API_KEY') || v('GEMINI_API_KEY'), models };
  const ai = resolveProvider(env);
  if (ai?.id === 'anthropic') return { kind: 'anthropic', apiKey: ai.apiKey, model: v('VISION_MODEL') || ai.model };
  if (ai?.id === 'gemini') return { kind: 'gemini', apiKey: ai.apiKey, models };
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
3. Mets en forme : commence par « # <titre> » (le titre écrit, sinon un titre court qui dit le sujet), puis des parties « ## », des listes « - », des listes numérotées si c'est numéroté, **gras** pour ce qui est souligné, encadré ou important. Formules en texte simple (x², √, ≤, →). Pas de tableau Markdown : un tableau devient une liste « - », une ligne par rangée, cellules séparées par « · ».
4. Un schéma ou un dessin : décris-le en une ou deux lignes en italique, à sa place, avec ses légendes.
5. Un mot illisible : écris [illisible]. Une photo sans texte ni schéma : dis-le en une phrase.
Réponds uniquement avec la fiche, sans phrase avant ni après.`;

/** The last reading, shown by /api/sante to find what goes wrong (never the photo nor the key). */
export const photoStatus = { lastOk: null, lastError: null, detail: null, seconds: null, model: null };

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
    console.error('[photo]', photoStatus.lastError, photoStatus.detail);
    throw e;
  }
}

async function readOnce(vision, photos, lang) {
  const system = PHOTO_SYSTEM + languageLine(lang);
  const ask = photos.length > 1 ? `Voici ${photos.length} photos, dans l'ordre.` : 'Voici la photo.';
  if (vision.kind === 'gemini') return geminiRead(vision, photos, system, ask);
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

/** A model Google no longer serves, or one that refuses the settings: try the next one. */
const tryNext = (status, detail) => status === 404 || (status === 400 && /not found|not supported|unsupported|thinking/i.test(detail));

/** Waiting this long for the first words of a model: it is stuck (overloaded, or thinking at length), the next one is tried. */
const FIRST_WORDS_MS = 30_000;
/** Stopped before the end with less than this: not a sheet, the next model is tried. */
const KEEP_PARTIAL_AFTER = 300; // characters
/** A page of notes is ~1 500 tokens: more is a model repeating itself. */
const MAX_OUTPUT = 4096;

/** At the bottom of a sheet read only in part. */
export const PARTIAL_NOTE = 'La lecture s’est arrêtée avant la fin de la page : vérifie et complète la fin.';

/** The same passage over and over at the end (a model in a loop on a hard page): the text up to its first time, else null. */
export function cutLoop(text) {
  const tail = text.slice(-1200);
  for (let size = 20; size <= 300; size += 1) {
    const unit = tail.slice(-size);
    if (unit.trim().length < 12) continue;
    let n = 1;
    while (tail.length >= size * (n + 1) && tail.slice(-size * (n + 1), -size * n) === unit) n++;
    if (n >= 4) return text.slice(0, text.length - size * (n - 1)).trimEnd();
  }
  return null;
}

/** Text parts of one Gemini answer (thoughts left out). */
const partsText = data => (data?.candidates?.[0]?.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? '').join('');
const finishOf = data => data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason;

/**
 * Reads Gemini's answer as it is written (SSE), so that a slow or looping model never ends in a timeout with nothing:
 * at `stopAt` (ms since epoch) what was read so far is kept, a loop is cut, no first words by `firstBy` gives up.
 * Also accepts a plain JSON body (one answer). Returns { text, partial, finish }.
 */
export async function readGeminiStream(res, { stopAt, firstBy, abort, onFirst }) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const data = await res.json().catch(() => null);
    return { text: partsText(data), partial: false, finish: finishOf(data) };
  }
  const decoder = new TextDecoder();
  let raw = '';
  let text = '';
  let finish;
  let pending = '';
  const take = line => {
    const json = line.replace(/^data:\s*/, '');
    if (!json || json === '[DONE]') return;
    try {
      const data = JSON.parse(json);
      text += partsText(data);
      finish = finishOf(data) ?? finish;
    } catch {
      /* not a whole JSON line */
    }
  };
  const stop = () => {
    abort();
    reader.cancel().catch(() => {});
  };
  for (;;) {
    const left = (text ? stopAt : Math.min(stopAt, firstBy)) - Date.now();
    let timer;
    const chunk = left > 0 ? await Promise.race([reader.read(), new Promise(r => (timer = setTimeout(() => r(null), left)))]) : null;
    clearTimeout(timer);
    if (!chunk || chunk.done) {
      if (!chunk) stop();
      if (pending.startsWith('data:')) take(pending);
      // A plain JSON answer (no « data: » lines).
      if (!text && raw.trim().startsWith('{')) {
        try {
          const data = JSON.parse(raw);
          text = partsText(data);
          finish = finishOf(data);
        } catch {
          /* not JSON either */
        }
      }
      return { text, partial: !chunk, finish };
    }
    const piece = decoder.decode(chunk.value, { stream: true });
    raw += piece;
    const lines = (pending + piece).split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) if (line.startsWith('data:')) take(line);
    if (text && onFirst) {
      onFirst();
      onFirst = null;
    }
    const loop = text.length > 600 ? cutLoop(text) : null;
    if (loop !== null) {
      stop();
      return { text: loop, partial: true, finish: 'LOOP' };
    }
  }
}

/**
 * Gemini's own API (not the OpenAI-compatible one): it lets the « thinking » of 2.5 models be turned off.
 * The answer is read as it comes. A model that hasn't written a word after HEDGE_MS gets company: the next model starts
 * beside it and the first to finish wins (test n°3: « Fiche depuis une photo » ended in a 504 after 85 s, each model
 * in turn waited for in vain). An overloaded one gives way at once; one silent for FIRST_WORDS_MS gives up; what is read
 * by the end of the time is kept (with PARTIAL_NOTE) instead of a timeout. `json`: an answer in JSON (no partial one).
 */
async function geminiRead(vision, photos, system, ask, { json = false, maxOutput = MAX_OUTPUT } = {}) {
  const deadline = Date.now() + TIMEOUT_MS;
  const tried = [];
  const out = model => tried.some(x => x.model === model && (x.gone || x.slow));
  // How little the model may think: 2.5 models take a budget (0 = none); later ones a level (« minimal », else « low »);
  // a model that refuses the setting is asked again without it.
  const thinking = model => (/2\.5/.test(model) ? [{ thinkingBudget: 0 }, null] : [{ thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, null]);
  const attempts = vision.models.flatMap(model => thinking(model).map(config => ({ model, config })));
  const notes = extra => [...tried.map(x => x.note), ...(extra ? [extra] : [])].join(' · ');
  let last = null;

  /** One model, one setting: its text, or a ProviderError (`next`: another attempt may do better). */
  async function attempt({ model, config }, ctrl, onFirst, lastChance) {
    const started = Date.now();
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: ask }, ...photos.map(p => ({ inline_data: { mime_type: p.mime, data: p.data } }))] }],
      generationConfig: { maxOutputTokens: maxOutput, temperature: 0.2, ...(json && { responseMimeType: 'application/json' }), ...(config && { thinkingConfig: config }) },
    };
    let res;
    try {
      res = await fetch(`${GEMINI_NATIVE}${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': vision.apiKey },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (e?.name !== 'AbortError' && e?.name !== 'TimeoutError') throw Object.assign(new ProviderError('upstream', 502, notes(`${model}: ${e?.message ?? 'réseau'}`)), { fatal: true });
      tried.push({ model, slow: true, note: `${model}: pas de réponse` });
      throw new ProviderError('timeout', 504, notes('plus de temps'));
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const message = String(data?.error?.message ?? res.statusText).slice(0, 120);
      // 404: Google no longer has this model (the next one is tried); 400 on the thinking setting: tried without it;
      // 429 or 5xx: this model is busy or overloaded, the next one may not be.
      const busy = res.status === 429 || res.status >= 500;
      tried.push({ model, gone: res.status === 404, slow: busy, note: `${model} ${res.status}${config ? ` (${Object.values(config)[0]})` : ''}` });
      const err = new ProviderError(res.status === 400 && /api[ _]?key/i.test(message) ? 'bad_key' : mapStatus(res.status), res.status, notes(message));
      if (!(tryNext(res.status, message) || busy)) err.fatal = true;
      throw err;
    }
    const got = await readGeminiStream(res, { stopAt: deadline - 2000, firstBy: lastChance() ? deadline : started + FIRST_WORDS_MS, abort: () => ctrl.abort(), onFirst });
    let text = got.text.trim();
    const cut = got.partial || got.finish === 'MAX_TOKENS';
    if (!text || (cut && (json || (text.length < KEEP_PARTIAL_AFTER && got.finish !== 'LOOP')))) {
      if (!cut) throw Object.assign(new ProviderError('upstream', 502, `${model}: réponse vide (${got.finish ?? '?'})`), { fatal: !json });
      tried.push({ model, slow: true, note: `${model}: trop lent (${Math.round((Date.now() - started) / 1000)} s)` });
      throw new ProviderError('timeout', 504, notes('plus de temps'));
    }
    // Stopped before the end (time, length, a loop): what was read is kept, and said at the bottom of the sheet.
    if (cut) text = `${text.replace(/^```(?:markdown|md)?\s*\n/i, '')}\n\n*${PARTIAL_NOTE}*`;
    photoStatus.model = `${model}${config ? ` (${Object.values(config)[0]})` : ''}${cut ? ` · coupée (${got.finish ?? 'temps'})` : ''}`;
    return text.replace(/^```(?:markdown|md|json)?\s*\n([\s\S]*?)\n```$/i, '$1').trim();
  }

  return new Promise((resolve, reject) => {
    /** attempt → { ctrl, wrote } for those under way (two at most). */
    const running = new Map();
    let settled = false;
    let hedge;
    const end = fn => {
      if (settled) return;
      settled = true;
      clearTimeout(hedge);
      for (const r of running.values()) r.ctrl.abort();
      fn();
    };
    // The next setting worth a try: not a model already out, nor one under way (its other settings wait for it).
    const pick = () => attempts.find(a => !a.done && !out(a.model) && ![...running.keys()].some(r => r.model === a.model));
    const launch = () => {
      const a = pick();
      if (!a || deadline - Date.now() < 8000) {
        if (!running.size) end(() => reject(last ?? new ProviderError('timeout', 504, 'plus de temps')));
        return;
      }
      a.done = true;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), deadline - Date.now());
      const r = { ctrl, wrote: false };
      running.set(a, r);
      // The last setting that may still be tried uses all the time left; an earlier one gives way when it doesn't write.
      const lastChance = () => !attempts.some(b => !b.done && !out(b.model) && b.model !== a.model);
      attempt(a, ctrl, () => (r.wrote = true), lastChance)
        .then(
          text => end(() => resolve(text)),
          e => {
            running.delete(a);
            if (settled) return;
            last = e;
            if (e?.fatal) return end(() => reject(e));
            launch();
            if (!running.size) end(() => reject(last));
          },
        )
        .finally(() => clearTimeout(timer));
      // Nothing written yet after a while: a second model starts beside it.
      clearTimeout(hedge);
      hedge = setTimeout(() => {
        if (!settled && running.size === 1 && ![...running.values()].some(x => x.wrote)) launch();
      }, vision.hedgeMs ?? HEDGE_MS);
    };
    launch();
  });
}

/** Waiting this long without a word from the model: a second one starts beside it. */
const HEDGE_MS = 12_000;

// ── A photo of a planning → slots to add (Kompaly's panel) ───────────────────

export const PLANNING_SYSTEM = `Tu reçois la photo d'un planning, d'un emploi du temps, d'un tableau de service ou d'un calendrier (imprimé, à l'écran ou écrit à la main).
Ton travail : relever chaque créneau qui y figure, fidèlement, pour l'ajouter à l'agenda de la personne.
Réponds uniquement avec un objet JSON : {"slots":[{"title":"…","date":"AAAA-MM-JJ","start":"HH:MM","end":"HH:MM","place":"…"}],"note":"…"}
- title : le nom du créneau tel qu'écrit (« Garde de nuit », « Maths », « Poste matin », un code comme « N » devient « Nuit » si la légende le dit), court.
- date : le jour exact. L'année et le mois manquants se déduisent de la date d'aujourd'hui donnée plus bas et de l'en-tête du planning (prends le plus proche à venir). Un jour introuvable : ne mets pas le créneau.
- start et end : les heures écrites (« 21h-7h » → "21:00" et "07:00", une fin le lendemain se garde telle quelle). Sans heure : laisse "".
- place : la salle ou le lieu écrit à côté, sinon "".
- Plusieurs personnes sur le planning : seulement la ligne ou la colonne dont le nom est donné plus bas ; sans nom donné et s'il y a plusieurs personnes, mets "note" pour demander laquelle et aucun créneau.
- N'invente rien : un créneau illisible ou incertain est laissé de côté et signalé en une phrase dans "note". Rien de lisible : "slots" vide et une phrase dans "note".
- Ce n'est pas un planning ni un emploi du temps (une photo ordinaire, un document, un paysage…) : "slots" vide, et "note" dit en une phrase, en tutoyant, ce que montre la photo et que tu ne lis que les plannings et emplois du temps pour en ajouter les horaires.
- La personne peut ajouter un message avec la photo (plus bas) : suis-le s'il précise quoi relever (une semaine, une ligne, un nom), sans rien inventer.`;

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** A day that exists (« 2026-02-30 » doesn't). */
const realDay = d => {
  const x = new Date(`${d}T12:00:00Z`);
  return !Number.isNaN(x.getTime()) && x.toISOString().slice(0, 10) === d;
};

/** The slots of the model's answer, cleaned: real days and hours, short titles, 60 at most. */
export function cleanSlots(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    const s = raw.trim().replace(/^```(?:json)?\s*\n?|\n?```$/g, '');
    try {
      data = JSON.parse(s);
    } catch {
      const m = s.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      try {
        data = m ? JSON.parse(m[0]) : null;
      } catch {
        data = null;
      }
    }
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.slots) ? data.slots : [];
  const hm = v => {
    const m = String(v ?? '').trim().match(/^(\d{1,2})(?:\s*[:hH]\s*(\d{2})?)?$/);
    const t = m ? `${m[1].padStart(2, '0')}:${m[2] ?? '00'}` : '';
    return HM.test(t) ? t : '';
  };
  const slots = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const date = String(x.date ?? '').trim();
    const title = String(x.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!YMD.test(date) || !realDay(date) || !title) continue;
    const start = hm(x.start);
    const end = start ? hm(x.end) : '';
    const place = String(x.place ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    slots.push({ title, date, ...(start && { start }), ...(end && { end }), ...(place && { place }) });
    if (slots.length >= 60) break;
  }
  const note = typeof data?.note === 'string' ? data.note.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  return { slots, ...(note && { note }) };
}

/** Reads a planning's photo(s): the slots it holds. `today` (YYYY-MM-DD) and `name` (whose line) from the page. */
export async function readPlanning(vision, photos, { today, name, lang, hint } = {}) {
  const t0 = Date.now();
  const day = YMD.test(String(today ?? '')) ? today : new Date().toISOString().slice(0, 10);
  const who = String(name ?? '').replace(/[\r\n<>"]+/g, ' ').trim().slice(0, 40);
  const system = `${PLANNING_SYSTEM}\nAujourd'hui : ${day}.${who ? ` La personne s'appelle ${who}.` : ''}${languageLine(lang)}`;
  const said = String(hint ?? '').replace(/[\r\n<>"«»]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  const ask = `${photos.length > 1 ? `Voici ${photos.length} photos, dans l'ordre.` : 'Voici la photo.'}${said ? ` Message de la personne : « ${said} ».` : ''}`;
  try {
    let text;
    if (vision.kind === 'gemini') text = await geminiRead(vision, photos, system, ask, { json: true, maxOutput: 4096 });
    else if (vision.kind === 'anthropic') {
      const r = await new Anthropic({ apiKey: vision.apiKey }).messages.create(
        { model: vision.model, max_tokens: 4000, system, messages: [{ role: 'user', content: [...photos.map(p => ({ type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } })), { type: 'text', text: ask }] }] },
        { timeout: TIMEOUT_MS },
      );
      text = r.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    } else {
      const data = await callOnce(vision, { model: vision.model, max_tokens: 4000, messages: [{ role: 'system', content: system }, { role: 'user', content: [{ type: 'text', text: ask }, ...photos.map(p => ({ type: 'image_url', image_url: { url: p.url } }))] }] }, TIMEOUT_MS);
      text = String(data.choices[0]?.message?.content ?? '');
    }
    Object.assign(photoStatus, { lastOk: new Date().toISOString(), lastError: null, detail: null, seconds: Math.round((Date.now() - t0) / 1000) });
    return cleanSlots(text);
  } catch (e) {
    Object.assign(photoStatus, { lastError: `${e?.code ?? e?.status ?? 'erreur'} ${e?.status ?? ''}`.trim(), detail: String(e?.detail ?? e?.message ?? '').slice(0, 200), seconds: Math.round((Date.now() - t0) / 1000) });
    throw e;
  }
}
