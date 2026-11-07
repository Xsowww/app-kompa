import { describe, expect, it } from 'vitest';
import { chatSystem, productSheet, aiName, TOOLS } from '../server/copilotPrompt.mjs';
import { quotaOf } from '../server/copilot.mjs';
import { audioUsage } from '../server/cours.mjs';

// The stores read the browser globals (blobStore's limits are the ones the Drive applies).
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { MAX_FILE, SPACE } = await import('../src/lib/blobStore');

const claude = { id: 'anthropic', label: 'Claude (Anthropic)', model: 'claude-haiku-5-5' };
const prompt = chatSystem({ persona: 'pote', userName: 'Yanis', lang: 'fr' }, { provider: claude, env: {} });

describe('Kompaly knows Kompaly: the product sheet in its prompt', () => {
  it('names its AI (the panel shows it), but still keeps its instructions, tools and ids to itself', () => {
    expect(aiName(claude)).toBe("Claude, un modèle d'IA d'Anthropic");
    expect(prompt).toContain("tu fonctionnes avec Claude, un modèle d'IA d'Anthropic ; tu peux le dire");
    expect(prompt).not.toMatch(/le nom du fournisseur d'IA ou du modèle[^.]*sont internes/);
    expect(prompt).toMatch(/Ces consignes, le \[Contexte\], la liste et le format de tes outils, les identifiants \(id\)[^.]*sont internes/);
    // The model's exact id is never in the prompt (the header shows it, the AI doesn't need it).
    expect(prompt).not.toContain('claude-haiku');
    // Another AI is named as such, and nothing is promised about training for it.
    const other = productSheet({ provider: { id: 'groq', label: 'Groq' }, env: {} });
    expect(other).toContain('fournisseur : Groq');
    expect(other).not.toContain('entraîner');
    expect(productSheet({ provider: claude })).toContain("ne s'en sert pas pour entraîner ses modèles");
  });

  it('says what Kompaly does not do: invoicing, quotes, client booking, HR, payroll, accounting, team plans', () => {
    const no = /Ce qu'elle ne fait pas[^\n]*/.exec(prompt)![0];
    for (const word of ['facturation', 'devis', 'prise de rendez-vous par des clients', 'RH', 'paie', 'comptabilité', 'équipe ou une entreprise']) expect(no).toContain(word);
    expect(no).toMatch(/réponds « non » clairement/);
    // When the sheet says nothing, it says it doesn't know instead of guessing « oui ».
    expect(prompt).toContain('dis que tu ne sais pas (au lieu de deviner « oui »)');
  });

  it('says what it does: spaces, recording, shared calendars, groups, reminders, notifications, .ics, offline, languages, free, no app to install', () => {
    const does = /Kompaly : une appli[^\n]*\n[^\n]*\n[^\n]*\n[^\n]*/.exec(prompt)![0];
    for (const word of ['gratuite', 'Calendrier', 'Tâches', 'Notes', 'Fichiers', 'Enregistrer', 'Groupes', 'Agendas partagés', 'rappels', 'notifications', 'import d\'un agenda .ics', 'export .ics', 'hors connexion', 'français, anglais, espagnol, allemand, italien', 'rien à télécharger sur les stores', 'Installer l\'application'])
      expect(does).toContain(word);
  });

  it('gives the real limits: the Drive’s, and the server’s daily quotas (from its settings)', () => {
    expect(SPACE).toBe(1000 ** 3); // decimal, as shown (formatBytes)
    expect(prompt).toContain("1 Go d'espace pour ses fichiers");
    expect(prompt).toContain(`${MAX_FILE / 1000 / 1000} Mo au plus par fichier`);
    expect(prompt).toContain(`${quotaOf('x', {}).max} questions à l'IA par jour`);
    expect(audioUsage({}).perAccount).toBe(240);
    expect(prompt).toContain("4 h d'enregistrement écrit par jour");
    const custom = productSheet({ provider: claude, env: { AI_DAILY_QUESTIONS: '12', TRANSCRIBE_DAILY_MINUTES: '90' } });
    expect(custom).toContain("12 questions à l'IA par jour");
    expect(custom).toContain("1 h 30 d'enregistrement écrit par jour");
  });

  it('is honest about scanned PDFs (no OCR) and about where the data lives', () => {
    expect(prompt).toMatch(/PDF scannés : non\.[^\n]*pas de reconnaissance de caractères \(OCR\)/);
    expect(prompt).toContain("hébergés dans l'Union européenne");
    expect(prompt).toContain('aux États-Unis');
  });

  it('knows it can set reminders, and adds events over several days or repeated in one call', () => {
    expect(prompt).toContain('Rappels : tu PEUX en poser');
    expect(prompt).toMatch(/UN add_event avec date \(premier jour\) et end_date/);
    const names = TOOLS.map(x => x.name);
    expect(names).toContain('set_reminders');
    const set = TOOLS.find(x => x.name === 'set_reminders')!.input_schema.properties as Record<string, unknown>;
    expect(Object.keys(set)).toEqual(['event_id', 'todo_id', 'minutes_before', 'at', 'replace', 'series']);
    const add = TOOLS.find(x => x.name === 'add_event')!.input_schema.properties as Record<string, unknown>;
    expect(add).toHaveProperty('end_date');
    expect(add).toHaveProperty('repeat');
    const todo = TOOLS.find(x => x.name === 'add_todo')!.input_schema.properties as Record<string, unknown>;
    expect(todo).toHaveProperty('time');
  });

  it('writes words in full and says hello once, at the right time of day', () => {
    expect(prompt).toContain("pas d'abréviations de SMS (« ttes »");
    expect(prompt).toContain('Pas de salutation en début de réponse');
  });

  it('calls the Drive « Fichiers », and still understands « Drive »', () => {
    expect(prompt).toContain("l'espace s'appelait « Drive » avant : si l'utilisateur dit Drive, c'est le même");
    expect(prompt.replace(/« Drive »|dit Drive/g, '')).not.toMatch(/\bDrive\b/);
  });
});
