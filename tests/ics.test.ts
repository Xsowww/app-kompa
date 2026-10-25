import { describe, expect, it } from 'vitest';
import { cancelledBy, foldLine, parseIcs, parseStamp, utcStamp } from '../src/lib/ics';

const now = new Date(2026, 9, 12);
const cal = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n');
const ev = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');

describe('parseIcs', () => {
  it('lit un événement simple, avec la salle dans les détails', () => {
    const [e] = parseIcs(cal(ev('UID:a', 'DTSTART:20261014T080000', 'DTEND:20261014T100000', 'SUMMARY:CM Chimie', 'LOCATION:Amphi A')), { now });
    expect(e).toMatchObject({ title: 'CM Chimie', date: '2026-10-14', start: '08:00', end: '10:00', externalId: 'a' });
    expect(e.details).toContain('Amphi A');
  });

  it('déroule une série hebdomadaire en sautant EXDATE et les séances annulées', () => {
    const text = cal(
      ev('UID:td', 'DTSTART:20261013T100000', 'DTEND:20261013T120000', 'RRULE:FREQ=WEEKLY;COUNT=4', 'EXDATE:20261027T100000', 'SUMMARY:TD'),
      ev('UID:td', 'RECURRENCE-ID:20261020T100000', 'DTSTART:20261020T100000', 'DTEND:20261020T120000', 'STATUS:CANCELLED', 'SUMMARY:TD'),
    );
    expect(parseIcs(text, { now }).map(e => e.date)).toEqual(['2026-10-13', '2026-11-03']);
  });

  it('une séance déplacée remplace celle de la série', () => {
    const text = cal(
      ev('UID:td', 'DTSTART:20261013T100000', 'DTEND:20261013T120000', 'RRULE:FREQ=WEEKLY;COUNT=2', 'SUMMARY:TD'),
      ev('UID:td', 'RECURRENCE-ID:20261020T100000', 'DTSTART:20261021T140000', 'DTEND:20261021T160000', 'SUMMARY:TD déplacé'),
    );
    expect(parseIcs(text, { now }).map(e => `${e.date} ${e.start} ${e.title}`)).toEqual(['2026-10-13 10:00 TD', '2026-10-21 14:00 TD déplacé']);
  });

  it('un événement sur une journée entière n’a pas d’heure', () => {
    const [e] = parseIcs(cal(ev('UID:f', 'DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261102', 'SUMMARY:Toussaint')), { now });
    expect(e.date).toBe('2026-11-01');
    expect(e.start).toBeUndefined();
  });
});

describe('parseIcs : plusieurs jours avec des heures', () => {
  it('découpe par jour : le premier jusqu’à 23:59, les jours du milieu entiers, le dernier dès 00:00', () => {
    const list = parseIcs(cal(ev('UID:sem', 'DTSTART:20261102T090000', 'DTEND:20261104T170000', 'SUMMARY:Séminaire')), { now });
    expect(list.map(e => `${e.externalId} ${e.date} ${e.start ?? '-'} ${e.end ?? '-'}`)).toEqual([
      'sem 2026-11-02 09:00 23:59',
      'sem_20261103 2026-11-03 - -',
      'sem_20261104 2026-11-04 00:00 17:00',
    ]);
  });

  it('finit à minuit : pas de jour vide en plus', () => {
    const list = parseIcs(cal(ev('UID:n', 'DTSTART:20261102T220000', 'DTEND:20261103T000000', 'SUMMARY:Soirée')), { now });
    expect(list.map(e => `${e.date} ${e.start} ${e.end}`)).toEqual(['2026-11-02 22:00 23:59']);
  });

  it('annulé : tous ses jours partent', () => {
    const cancelled = cancelledBy(cal(ev('UID:sem', 'DTSTART:20261102T090000', 'DTEND:20261104T170000', 'STATUS:CANCELLED')));
    expect(['sem', 'sem_20261103', 'sem_20261104'].every(cancelled)).toBe(true);
    expect(cancelled('sem_autre')).toBe(false);
    expect(cancelled('semaine')).toBe(false);
  });
});

describe('cancelledBy', () => {
  it('reconnaît une séance annulée, une séance exclue et une série annulée', () => {
    const cancelled = cancelledBy(
      cal(
        ev('UID:td', 'DTSTART:20261013T100000', 'RRULE:FREQ=WEEKLY', 'EXDATE:20261027T100000', 'SUMMARY:TD'),
        ev('UID:td', 'RECURRENCE-ID:20261020T100000', 'DTSTART:20261020T100000', 'STATUS:CANCELLED'),
        ev('UID:cm', 'DTSTART:20261013T080000', 'RRULE:FREQ=WEEKLY', 'STATUS:CANCELLED'),
        ev('UID:solo', 'DTSTART:20261015T080000', 'STATUS:CANCELLED'),
      ),
    );
    expect(['td_20261020', 'td_20261027', 'cm_20261110', 'solo'].every(cancelled)).toBe(true);
    expect(cancelled('td_20261013')).toBe(false);
  });
});

describe('parseStamp', () => {
  it('convertit une heure avec TZID connu, quel que soit le fuseau de l’appareil', () => {
    expect(parseStamp('20261012T080000', { TZID: 'Europe/Paris' })!.date.getTime()).toBe(Date.UTC(2026, 9, 12, 6)); // heure d'été
    expect(parseStamp('20261212T080000', { TZID: 'Europe/Paris' })!.date.getTime()).toBe(Date.UTC(2026, 11, 12, 7));
    expect(parseStamp('20261012T080000', { TZID: 'America/Martinique' })!.date.getTime()).toBe(Date.UTC(2026, 9, 12, 12));
  });

  it('garde l’heure telle quelle pour un TZID inconnu', () => {
    expect(parseStamp('20261012T080000', { TZID: 'Romance Standard Time' })!.date.getHours()).toBe(8);
  });
});

describe('export', () => {
  it('plie les lignes à 75 octets sans couper un caractère, et la relecture les recolle', () => {
    const title = 'Révisions générales — anatomie, physiologie, biochimie et sémiologie (amphi Pasteur, bâtiment B)';
    const folded = foldLine(`SUMMARY:${title}`);
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(lines.slice(1).every(l => l.startsWith(' '))).toBe(true);
    const [e] = parseIcs(cal(ev('UID:x', 'DTSTART:20261016T120000Z', folded)), { now });
    expect(e.title).toBe(title);
  });

  it('écrit les heures en UTC, relues à la même heure locale', () => {
    const stamp = utcStamp('2026-10-16', '14:00');
    expect(stamp).toMatch(/^\d{8}T\d{6}Z$/);
    const [e] = parseIcs(cal(ev('UID:y', `DTSTART:${stamp}`, `DTEND:${utcStamp('2026-10-16', '15:30')}`, 'SUMMARY:TD')), { now });
    expect(e).toMatchObject({ date: '2026-10-16', start: '14:00', end: '15:30' });
  });

  it('laisse une ligne courte telle quelle', () => {
    expect(foldLine('SUMMARY:TD')).toBe('SUMMARY:TD');
  });
});

describe('emploi du temps Hyperplanning : titre et notes courts', () => {
  it('the subject as title, the room once, no class list nor memo', () => {
    const text = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:hp1', 'DTSTART:20261102T073000Z', 'DTEND:20261102T110000Z',
      'SUMMARY:Welcome Day 7 - Aix-en-Provence | DCGA MAST1\\, Aix-en-Provence | EANI3D MAST1 - CAMPUS - FFP', 'LOCATION:Salle 307',
      'DESCRIPTION:Matière : Welcome Day 7\\nEnseignant : M. Martin\\nClasses : Aix-en-Provence | DCGA MAST1\\nSalle : Salle 307\\nMémo : CAMPUS\\nType : FFP',
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const [e] = parseIcs(text, { now: new Date(2026, 9, 1) });
    expect(e.title).toBe('Welcome Day 7');
    expect(e.details).toBe('Salle 307\nEnseignant : M. Martin');
  });
});
