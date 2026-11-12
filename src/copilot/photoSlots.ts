// « Photo d'un planning » in Kompaly's panel (test n°3, blocker n°2: « j'ai pris mon planning en photo et on me répond
// écris-les une par une »). The photo is read on the server by the vision model of « Fiche depuis une photo »
// (server/photo.mjs › readPlanning); the slots found are shown as a list with one button « Ajouter ces N créneaux »:
// nothing is added before that click. Then they are added, sent and read back like Kompaly's own additions.

import { CoursError, readPlanningPhoto, type PlanningSlot } from '../lib/recorder/api';
import { useCalendar } from '../store/calendar';
import { useAuth } from '../store/auth';
import { fmtDay, fromKey, todayKey } from '../lib/dates';
import { addEvents, hourLabel, linkToDay } from './actions';
import { asyncOffers } from './offers';
import { confirmSaved } from './saveCheck';
import type { CopilotOffer } from '../store/copilot';
import { t, tn } from '../i18n';

/** A photo made lighter (1600 px at most, JPEG): a planning's small print stays readable, quick to send from a phone. */
export async function shrinkPhoto(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.8);
}

/** « Lundi 10 nov. · 21h–7h · Garde de nuit (Service B) »: one line of the list. */
export function slotLine(s: PlanningSlot): string {
  const time = s.start ? ` · ${hourLabel(s.start)}${s.end ? `–${hourLabel(s.end)}` : ''}` : '';
  const day = fmtDay(fromKey(s.date), 'EEEE d MMM');
  return `${day.charAt(0).toUpperCase()}${day.slice(1)}${time} · ${s.title}${s.place ? ` (${s.place})` : ''}`;
}

/** Why it didn't work, in the person's words (the same as « Fiche depuis une photo »). */
export function photoFailure(e: unknown): string {
  const code = e instanceof CoursError ? e.code : '';
  if (code === 'simple_only') return t('Le mode simple uniquement est activé (Réglages › Kompaly) : la photo n’est envoyée à aucune IA.');
  if (code === 'disabled' || code === 'http_404') return t('La lecture des photos n’est pas encore activée sur Kompaly.');
  if (code === 'daily_limit' || code === 'site_limit') return t('Limite du jour atteinte : réessaie demain.');
  if (code === 'rate_limited') return t('Beaucoup de demandes en ce moment : réessaie dans une minute.');
  if (code === 'too_large' || code === 'http_413') return t('Photos trop lourdes : enlève-en une et réessaie.');
  if (code === 'timeout' || code === 'http_504' || code === 'http_524') return t('La lecture a pris trop de temps. Réessaie dans un instant, avec une photo nette et bien éclairée.');
  if (code === 'network') return t('Pas de réponse. Vérifie ta connexion et réessaie.');
  if (code === 'bad_photo' || code === 'empty_answer' || code === 'http_400') return t('La lecture n’a pas marché. Réessaie avec une photo plus nette.');
  return t('Le service de lecture ne répond pas. Réessaie dans quelques minutes.');
}

/** The answer to a photo: the slots as a list and the button that adds them (or why there are none). */
export function slotsReply(slots: PlanningSlot[], note: string): { text: string; offers?: CopilotOffer[] } {
  if (!slots.length) return { text: note || t('Je n’ai trouvé aucun créneau lisible sur cette photo. Essaie avec une photo plus nette, bien à plat, ou dis-les-moi (« lundi 21h-7h »).') };
  const shown = slots.slice(0, 20).map(s => `- ${slotLine(s)}`);
  const more = slots.length > 20 ? `\n- ${tn(slots.length - 20, '… et {n} autre', '… et {n} autres')}` : '';
  return {
    text: `${tn(slots.length, 'J’ai lu {n} créneau sur ta photo :', 'J’ai lu {n} créneaux sur ta photo :')}\n${shown.join('\n')}${more}${note ? `\n\n${note}` : ''}\n\n${t('Vérifie-les : rien n’est ajouté avant ton clic.')}`,
    offers: [{ label: tn(slots.length, 'Ajouter ce créneau', 'Ajouter ces {n} créneaux'), kind: 'add_slots', payload: { slots: JSON.stringify(slots) } }],
  };
}

/** Reads the photo on the server. Throws a CoursError (photoFailure says it). */
export async function readSlots(file: Blob, stop?: AbortSignal, hint = '') {
  const photo = await shrinkPhoto(file);
  return readPlanningPhoto([photo], { today: todayKey(), name: useAuth.getState().user?.name ?? '', ...(hint && { hint }) }, stop);
}

/** « Ajouter ces N créneaux »: added to the calendar, then read back from the server before saying so. */
asyncOffers.add_slots = async p => {
  const slots = (JSON.parse(p.slots ?? '[]') as PlanningSlot[]).filter(s => s && s.title && /^\d{4}-\d{2}-\d{2}$/.test(s.date));
  if (!slots.length) return { text: t('Je ne retrouve plus ces créneaux : reprends la photo.') };
  const ids: string[] = [];
  let first: { date: string; id: string } | null = null;
  for (const s of slots) {
    // A night (« 21h-7h ») ends the next morning: addEvents makes it one event over two days.
    const res = addEvents({ title: s.title, date: s.date, start: s.start, end: s.end, place: s.place });
    const all = res.first.series ? useCalendar.getState().events.filter(e => e.series === res.first.series).map(e => e.id) : [res.first.id];
    ids.push(...all);
    if (!first || s.date < first.date) first = { date: s.date, id: res.first.id };
  }
  const check = await confirmSaved('events', ids);
  const link = first ? [{ label: t('Voir le planning'), to: linkToDay(first.date, first.id) }] : [];
  if (!check.ok && !check.offline)
    return {
      text: t('Pas enregistré en ligne : le serveur l’a refusé. Ça reste seulement sur cet appareil (tes autres appareils ne le verront pas).'),
      links: link,
      offers: [{ label: t('Réessayer l’enregistrement'), kind: 'retry_save', payload: { writes: JSON.stringify([{ table: 'events', ids: check.missing ?? ids }]) } }],
    };
  const saved = tn(slots.length, 'C’est ajouté : {n} créneau dans ton agenda.', 'C’est ajouté : {n} créneaux dans ton agenda.');
  return { text: check.offline ? `${saved} ${t('Pas de réseau pour l’instant : ils partiront dès qu’il revient.')}` : saved, links: link };
};
