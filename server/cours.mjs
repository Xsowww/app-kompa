// « Enregistrer un cours » : the class is heard in the browser and sent here in short pieces of sound
// (16 kHz mono WAV, about 20 s each) to be written down by a speech-to-text model (Whisper, Groq by default).
// Then the AI rewrites the transcript part by part into a clean course, and makes the revision sheet and the exam.
// The sound is never stored: each piece is forwarded and forgotten.

import { resolveProvider, parseWait, mapStatus, ProviderError } from './aiProviders.mjs';
import { authenticate, chat, ipOf, overQuota, rateLimited, readJson, secondsToParisMidnight, send } from './copilot.mjs';
import { pushToUser } from './push.mjs';

const MAX_AUDIO = 3_000_000; // bytes: 90 s of 16 kHz 16-bit mono, a piece is 15-35 s
const BYTES_PER_SECOND = 32_000;
const PER_USER_PER_MIN = 12;
const PER_IP_PER_MIN = 120;

/** Who writes down the sound. Groq's Whisper by default (same key as the AI when the AI is Groq). */
export function resolveTranscriber(env = process.env) {
  const v = name => String(env[name] ?? '').trim();
  const ai = resolveProvider(env);
  const apiKey = v('TRANSCRIBE_API_KEY') || (ai?.id === 'groq' ? ai.apiKey : '') || v('GROQ_API_KEY');
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: v('TRANSCRIBE_BASE_URL') || 'https://api.groq.com/openai/v1',
    model: v('TRANSCRIBE_MODEL') || 'whisper-large-v3-turbo',
    groq: !v('TRANSCRIBE_BASE_URL') || /groq\.com/.test(v('TRANSCRIBE_BASE_URL')),
  };
}

// ── Daily audio allowance ───────────────────────────────────────────────────
// Groq's free Whisper hears 8 h of sound a day for the whole site: a cap per student keeps some for the others.
let day = '';
let perUser = new Map();
let siteSeconds = 0;
const parisDay = () => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());

/** Counts `seconds` of sound. Returns the error code when a limit is reached, else null. */
export function overAudioQuota(who, seconds, t, env = process.env) {
  if (day !== parisDay()) {
    day = parisDay();
    perUser = new Map();
    siteSeconds = 0;
  }
  const userMax = (Number(env.TRANSCRIBE_DAILY_MINUTES) || 240) * 60;
  const siteMax = (Number(env.TRANSCRIBE_SITE_MINUTES) || (t.groq ? 450 : Infinity)) * 60;
  const used = perUser.get(who) ?? 0;
  if (siteSeconds + seconds > siteMax) return 'site_limit';
  if (used + seconds > userMax) return 'daily_limit';
  perUser.set(who, used + seconds);
  siteSeconds += seconds;
  return null;
}

/** A 16 kHz mono 16-bit PCM WAV, as the page makes them. Returns its length in seconds, or null. */
export function wavSeconds(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  const channels = buf.readUInt16LE(22);
  const rate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  if (channels !== 1 || rate !== 16_000 || bits !== 16) return null;
  return (buf.length - 44) / BYTES_PER_SECOND;
}

// What Whisper writes on silence or noise (it learnt them from subtitles): never part of a class.
const HALLUCINATIONS = [
  /sous-titr(es|age)( réalisés?)?( par| par la communauté d'amara\.org)?/i,
  /amara\.org/i,
  /merci d'avoir regardé/i,
  /abonnez-vous/i,
  /^\W*(merci|musique|applaudissements|rires)\W*$/i,
  /^\W*$/,
];

/** Whisper's segments → the ones that are speech, as { start, end, text }. */
export function cleanSegments(data) {
  const raw = Array.isArray(data?.segments) ? data.segments : [{ start: 0, end: 0, text: String(data?.text ?? '') }];
  const out = [];
  for (const s of raw) {
    const text = String(s.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text || HALLUCINATIONS.some(r => r.test(text))) continue;
    // Very likely no speech, and a low confidence: noise turned into words.
    if (Number(s.no_speech_prob) > 0.6 && Number(s.avg_logprob) < -0.8) continue;
    // The same short sentence over and over: a loop on a silence.
    if (out.length >= 2 && out.at(-1).text === text && out.at(-2).text === text) continue;
    out.push({ start: Number(s.start) || 0, end: Number(s.end) || 0, text });
  }
  return out;
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error('too_large'), { status: 413 }));
        chunks.length = 0;
        req.removeAllListeners('data');
        req.removeAllListeners('end');
        req.resume();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function transcribe(t, wav, hint) {
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'morceau.wav');
  form.append('model', t.model);
  form.append('language', 'fr');
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  if (hint) form.append('prompt', hint);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  let res;
  try {
    res = await fetch(`${t.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${t.apiKey}` }, body: form, signal: ctrl.signal });
  } catch (e) {
    throw new ProviderError(e?.name === 'AbortError' ? 'timeout' : 'upstream', e?.name === 'AbortError' ? 504 : 502, e?.message);
  } finally {
    clearTimeout(timer);
  }
  const raw = await res.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    /* not JSON */
  }
  if (!res.ok || data?.error) {
    const error = new ProviderError(mapStatus(res.status), res.status, String(data?.error?.message ?? raw).slice(0, 300));
    if (error.code === 'rate_limited') error.retryAfter = parseWait(res.headers.get('retry-after')) ?? 20;
    throw error;
  }
  return cleanSegments(data);
}

// ── Writing the course ──────────────────────────────────────────────────────

const FORMAT = `Écris en français, en Markdown simple uniquement : « ## » et « ### » pour les titres, « - » pour les listes, « 1. » pour les étapes, **gras** pour les mots importants. Pas de tableau, pas d'emoji, pas de HTML.`;

const ANSWER_PART = `Réponds EXACTEMENT dans ce format, sans rien avant ni après :
TITRE: <titre court de cette partie>
---
<le texte rédigé de cette partie, avec des sous-titres « ### » si besoin, sans répéter le titre>
---
POINTS:
- <3 à 6 points essentiels de cette partie, une phrase chacun>`;
const ANSWER_POINTS = `Réponds EXACTEMENT dans ce format, sans rien avant ni après :
POINTS:
- <un point essentiel par ligne, une phrase chacun, 4 à 10 points>`;
const CLEAN = `- corrige les mots mal reconnus d'après le contexte (et les mots-clés donnés), enlève les hésitations et les digressions sans intérêt ;
- n'invente rien ; si un passage est incompréhensible, résume-le prudemment ou ignore-le ;
- les passages marqués ⚑ ont été signalés comme importants : mets-les en valeur.`;

/** What the AI is asked, for a class (études), a meeting (travail) or anything else recorded (perso). */
export const SYSTEMS = {
  etudes: {
    partie: `Tu aides un étudiant : tu reçois un morceau de la transcription automatique de son cours (reconnaissance vocale, donc avec des erreurs, des hésitations, des répétitions).
Réécris CE morceau en un vrai cours, propre et structuré, comme un très bon étudiant le prendrait en notes :
- garde TOUTE l'information : définitions, exemples, chiffres, dates, formules, consignes du professeur (examens, devoirs, dates limites) ;
${CLEAN}
${FORMAT}
${ANSWER_PART}`,
    points: `Tu reçois un extrait d'un cours. Donne les points essentiels à retenir (définitions, idées clés, chiffres, dates, méthodes, consignes d'examen).
${ANSWER_POINTS}`,
    fiche: `Tu fais une fiche de révision d'une à deux pages à partir des points essentiels d'un cours.
Commence par « # Fiche de révision : <titre> ». Puis, s'il y en a, « ## À ne pas oublier » avec les infos pratiques (examens, devoirs, dates, consignes du professeur).
Puis l'essentiel du cours, regroupé en quelques parties « ## » courtes : définitions, idées clés, formules ou méthodes, exemples types. Termine par « ## Pour vérifier que tu sais » avec 3 à 5 questions rapides (sans réponses).
Phrases courtes, listes, **gras** sur les mots à connaître. N'invente rien qui ne soit pas dans les points.
${FORMAT}`,
    examen: `Tu écris un examen d'entraînement sur un cours, à partir de ses points essentiels.
Commence par « # Examen : <titre> », puis une ligne de consignes (durée conseillée, barème sur 20).
« ## Partie 1 : questions de cours » : 4 à 6 questions courtes. « ## Partie 2 : QCM » : 5 questions, 4 choix (a, b, c, d) chacune, une seule bonne réponse.
« ## Partie 3 : réflexion » : 1 ou 2 questions ou un exercice d'application qui demande de raisonner.
Indique les points de chaque partie. Puis « ## Corrigé » avec les réponses détaillées de toutes les questions, dans l'ordre.
Uniquement sur ce qui est dans le cours, rien d'inventé.
${FORMAT}`,
  },
  travail: {
    partie: `Tu aides un professionnel : tu reçois un morceau de la transcription automatique d'une réunion (reconnaissance vocale, donc avec des erreurs, des hésitations, des répétitions).
Réécris CE morceau en compte rendu clair et structuré :
- garde TOUTE l'information utile : sujets abordés, chiffres, dates, décisions prises, actions à faire (qui, quoi, pour quand), questions restées ouvertes ;
- nomme les personnes seulement si leur nom est dit ; style neutre et professionnel ;
${CLEAN}
${FORMAT}
${ANSWER_PART}`,
    points: `Tu reçois un extrait d'un compte rendu de réunion ou d'un document de travail. Donne les points essentiels (décisions, actions, chiffres, dates, échéances).
${ANSWER_POINTS}`,
    fiche: `Tu fais le résumé d'une réunion (une page) à partir de ses points essentiels.
Commence par « # Résumé : <titre> ». Puis « ## Décisions », « ## Actions à faire » (une ligne par action : qui, quoi, pour quand, si c'est connu), « ## Dates et échéances » s'il y en a, « ## Points clés » et « ## Questions ouvertes » s'il y en a.
Phrases courtes, listes, **gras** sur l'essentiel. N'invente rien qui ne soit pas dans les points.
${FORMAT}`,
    examen: `Tu écris des questions de compréhension sur une réunion ou un document de travail, à partir de ses points essentiels, pour vérifier qu'on a bien tout retenu.
Commence par « # Questions de compréhension : <titre> ». « ## Questions » : 6 à 8 questions courtes, puis « ## QCM » : 4 questions, 4 choix (a, b, c, d), une seule bonne réponse.
Puis « ## Réponses » avec les réponses, dans l'ordre. Uniquement sur ce qui a été dit, rien d'inventé.
${FORMAT}`,
  },
  perso: {
    partie: `Tu reçois un morceau de la transcription automatique d'un enregistrement (conférence, podcast, vidéo, discussion…), avec des erreurs de reconnaissance vocale.
Réécris CE morceau en texte clair et structuré, facile à relire :
- garde TOUTE l'information : idées, exemples, chiffres, dates, conseils ;
${CLEAN}
${FORMAT}
${ANSWER_PART}`,
    points: `Tu reçois un extrait d'un document. Donne les points essentiels à retenir (idées clés, chiffres, dates, conseils).
${ANSWER_POINTS}`,
    fiche: `Tu fais un résumé d'une page à partir des points essentiels d'un enregistrement ou d'un document.
Commence par « # Résumé : <titre> ». Puis l'essentiel, regroupé en quelques parties « ## » courtes : idées clés, chiffres et dates, conseils ou choses à faire.
Phrases courtes, listes, **gras** sur l'essentiel. N'invente rien qui ne soit pas dans les points.
${FORMAT}`,
    examen: `Tu écris un petit quiz pour vérifier qu'on a retenu l'essentiel d'un enregistrement ou d'un document, à partir de ses points essentiels.
Commence par « # Quiz : <titre> ». « ## Questions » : 5 à 7 questions courtes, puis « ## QCM » : 4 questions, 4 choix (a, b, c, d), une seule bonne réponse.
Puis « ## Réponses », dans l'ordre. Uniquement sur ce qui a été dit, rien d'inventé.
${FORMAT}`,
  },
};

const MAX_TOKENS = { partie: 3000, points: 1200, fiche: 2500, examen: 3500 };
const clip = (v, n) => String(v ?? '').slice(0, n);

function userMessage(task, body) {
  const title = clip(body.title, 120) || 'Sans titre';
  if (task === 'partie') {
    const words = Array.isArray(body.keywords) ? body.keywords.slice(0, 40).map(k => clip(k, 40)).join(', ') : '';
    const head = [`Titre : ${title}`, words && `Mots-clés : ${words}`, body.before && `Fin de la partie précédente (contexte, à ne pas réécrire) : « ${clip(body.before, 600)} »`];
    return `${head.filter(Boolean).join('\n')}\n\nTranscription :\n${clip(body.text, 14_000)}`;
  }
  if (task === 'points') return `Titre : ${title}\n\n${clip(body.text, 14_000)}`;
  const points = Array.isArray(body.points) ? body.points.map(p => `- ${clip(p, 400)}`).join('\n').slice(0, 14_000) : '';
  const parts = Array.isArray(body.parts) ? body.parts.map(p => `- ${clip(p, 120)}`).join('\n').slice(0, 2000) : '';
  const moments = Array.isArray(body.moments) ? body.moments.map(m => `- ${clip(m, 300)}`).join('\n').slice(0, 4000) : '';
  return [`Titre : ${title}`, parts && `Plan :\n${parts}`, moments && `Moments signalés pendant l'enregistrement (consignes, mots-clés entendus) :\n${moments}`, `Points essentiels :\n${points}`].filter(Boolean).join('\n\n');
}

/** « TITRE: … --- texte --- POINTS: - … » → { title, text, points }, tolerant of a model that strays a little. */
export function parseSection(raw) {
  const s = String(raw ?? '').replace(/\r/g, '').trim();
  const title = /^\s*TITRE\s*:\s*(.+)$/im.exec(s)?.[1]?.trim().replace(/^#+\s*/, '') ?? '';
  const pointsAt = s.search(/^\s*POINTS\s*:/im);
  const points = pointsAt >= 0 ? s.slice(pointsAt).split('\n').slice(1).map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean) : [];
  let text = pointsAt >= 0 ? s.slice(0, pointsAt) : s;
  text = text.replace(/^\s*TITRE\s*:.*$/im, '');
  text = text.replace(/^\s*-{3,}\s*$/gm, '').trim();
  return { title, text, points: points.slice(0, 12) };
}

/** Node-style handler for /api/cours/*. Returns false if the URL isn't ours. */
export async function handleCours(req, res, env = process.env) {
  const url = (req.url ?? '').split('?')[0];
  if (!url.startsWith('/api/cours/')) return false;

  if (url === '/api/cours/etat' && req.method === 'GET') {
    send(res, 200, { transcription: !!resolveTranscriber(env), redaction: !!resolveProvider(env) });
    return true;
  }
  if (req.method !== 'POST' || !['/api/cours/transcrire', '/api/cours/rediger', '/api/cours/alerte'].includes(url)) {
    send(res, 404, { error: 'not_found' });
    return true;
  }
  const ip = ipOf(req, env);
  if (rateLimited(`cours-ip:${ip}`, PER_IP_PER_MIN)) {
    send(res, 429, { error: 'rate_limited', retryAfter: 30 });
    return true;
  }
  const caller = await authenticate(req, env);
  if (!caller) {
    send(res, 401, { error: 'unauthorized' });
    return true;
  }
  const who = caller.id ?? ip;

  try {
    // A keyword heard: also on the student's other devices (their phone), if they turned notifications on there.
    if (url === '/api/cours/alerte') {
      if (!caller.id || rateLimited(`cours-alerte:${who}`, 20)) return (send(res, 429, { error: 'rate_limited' }), true);
      const body = await readJson(req);
      const ok = await pushToUser(caller.id, { title: clip(body.title, 120), body: clip(body.body, 300), url: '/enregistrer', tag: 'cours' }, clip(body.except, 600));
      send(res, ok ? 200 : 503, { ok });
      return true;
    }
    if (url === '/api/cours/transcrire') {
      const t = resolveTranscriber(env);
      if (!t) return (send(res, 503, { error: 'disabled' }), true);
      if (rateLimited(`cours-user:${who}`, PER_USER_PER_MIN)) return (send(res, 429, { error: 'rate_limited', retryAfter: 20 }), true);
      const wav = await readBody(req, MAX_AUDIO);
      const seconds = wavSeconds(wav);
      if (seconds === null || seconds < 0.5) return (send(res, 400, { error: 'bad_audio' }), true);
      const limit = overAudioQuota(who, seconds, t, env);
      if (limit) return (send(res, 429, { error: limit, retryAfter: secondsToParisMidnight() }), true);
      let hint = '';
      try {
        // Whisper reads at most ~220 tokens of context.
        hint = clip(decodeURIComponent(String(req.headers['x-indice'] ?? '')), 400);
      } catch {
        /* badly encoded: no hint */
      }
      send(res, 200, { segments: await transcribe(t, wav, hint) });
      return true;
    }

    const provider = resolveProvider(env);
    if (!provider) return (send(res, 503, { error: 'disabled' }), true);
    const body = await readJson(req);
    const usage = Object.hasOwn(SYSTEMS, body.usage) ? body.usage : 'etudes';
    const task = Object.hasOwn(SYSTEMS.etudes, body.task) ? body.task : null;
    if (!task) return (send(res, 400, { error: 'bad_task' }), true);
    if ((task === 'partie' || task === 'points') && !String(body.text ?? '').trim()) return (send(res, 400, { error: 'empty' }), true);
    const limit = overQuota(who, false, provider, env);
    if (limit) return (send(res, 429, { error: limit, retryAfter: secondsToParisMidnight() }), true);
    const response = await chat(provider, {
      system: SYSTEMS[usage][task],
      messages: [{ role: 'user', content: userMessage(task, body) }],
      maxTokens: MAX_TOKENS[task],
      timeoutMs: 90_000,
    });
    const text = response.stop_reason === 'refusal' ? '' : response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!text) return (send(res, 502, { error: 'empty_answer' }), true);
    if (task === 'partie') send(res, 200, parseSection(text));
    else if (task === 'points') send(res, 200, { points: parseSection(text).points });
    else send(res, 200, { text });
  } catch (e) {
    if (e instanceof ProviderError) send(res, { timeout: 504, rate_limited: 429, too_large: 413 }[e.code] ?? 502, { error: e.code, retryAfter: e.retryAfter });
    else if (e?.status === 429) send(res, 429, { error: 'rate_limited', retryAfter: 30 });
    else send(res, e?.status ?? 500, { error: e?.message ?? 'server_error' });
  }
  return true;
}
