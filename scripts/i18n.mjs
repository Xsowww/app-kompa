// The texts to translate: every t('…') and tn(n, '…', '…') in src/, compared with src/i18n/*.json.
//   node scripts/i18n.mjs          → what is missing or unused, per language
//   node scripts/i18n.mjs --write  → adds the missing keys (empty) and removes the unused ones
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
export const LANGS = ['en', 'es', 'de', 'it'];

function files(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|mjs)$/.test(f) && !f.endsWith('.d.ts') ? [p] : [];
  });
}

/** Reads the string literal at `i` ('…', "…", or `…` without ${}); null if there is none. */
function literal(src, i) {
  while (/\s/.test(src[i])) i++;
  const q = src[i];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  let out = '';
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') {
      const n = src[++j];
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'u' ? String.fromCharCode(parseInt(src.slice(j + 1, (j += 4) + 1), 16)) : n;
      continue;
    }
    if (q === '`' && c === '$' && src[j + 1] === '{') return null;
    if (c === q) return { text: out, end: j + 1 };
    out += c;
  }
  return null;
}

/** Skips one argument (up to the comma at depth 0). */
function skipArg(src, i) {
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const l = literal(src, i);
      if (l) i = l.end - 1;
    } else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) return i + 1;
    if (depth < 0) return -1;
  }
  return -1;
}

/** { keys: Map<text, first place>, dynamic: places where t() gets something else than a plain text } */
export function collect() {
  const keys = new Map();
  const dynamic = [];
  for (const file of files(join(ROOT, 'src'))) {
    if (file.includes(`${join('src', 'i18n')}`)) continue;
    const src = readFileSync(file, 'utf8');
    const where = i => `${relative(ROOT, file)}:${src.slice(0, i).split('\n').length}`;
    const add = (text, i) => keys.has(text) || keys.set(text, where(i));
    for (const m of src.matchAll(/(?<![\w.$])(tn?)\(/g)) {
      let i = m.index + m[0].length;
      if (m[1] === 'tn') {
        i = skipArg(src, i);
        if (i < 0) continue;
        const one = literal(src, i);
        const comma = one && /^\s*,/.exec(src.slice(one.end));
        const many = comma && literal(src, one.end + comma[0].length);
        if (!one || !many) dynamic.push(where(m.index));
        else add(one.text, m.index), add(many.text, m.index);
        continue;
      }
      const l = literal(src, i);
      if (l) add(l.text, m.index);
      else if (src[i] !== ')') dynamic.push(where(m.index));
    }
  }
  return { keys, dynamic };
}

const vars = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

/** Per language: keys without a translation, translations no longer used, {placeholders} that differ. */
export function check() {
  const { keys, dynamic } = collect();
  const out = { total: keys.size, dynamic, langs: {} };
  for (const l of LANGS) {
    const dict = JSON.parse(readFileSync(join(ROOT, 'src/i18n', `${l}.json`), 'utf8'));
    out.langs[l] = {
      missing: [...keys.keys()].filter(k => !dict[k]),
      unused: Object.keys(dict).filter(k => !keys.has(k)),
      badVars: [...keys.keys()].filter(k => dict[k] && vars(dict[k]) !== vars(k)),
    };
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes('--write');
  const { keys } = collect();
  const r = check();
  console.log(`${r.total} textes à traduire`);
  for (const d of r.dynamic) console.log(`  t() sans texte fixe : ${d}`);
  for (const l of LANGS) {
    const { missing, unused, badVars } = r.langs[l];
    console.log(`${l} : ${missing.length} manquants, ${unused.length} inutilisés, ${badVars.length} variables différentes`);
    for (const k of badVars) console.log(`  ${l} {…} différent : ${JSON.stringify(k)}`);
    if (write) {
      const p = join(ROOT, 'src/i18n', `${l}.json`);
      const dict = JSON.parse(readFileSync(p, 'utf8'));
      const next = {};
      for (const k of keys.keys()) next[k] = dict[k] ?? '';
      writeFileSync(p, `${JSON.stringify(next, null, 1)}\n`);
    }
  }
}
