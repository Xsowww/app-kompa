import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Search, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fmt } from '../../lib/dates';
import { useNotes, type Note, type NoteLink } from '../../store/notes';
import { useDrive, categoryOf, type DriveItem } from '../../store/drive';
import { useCalendar, catOf, sortEvents, type CalendarEvent } from '../../store/calendar';
import { Modal } from '../../components/Overlays';
import FileIcon from '../../components/FileIcon';
import { cx, normalize } from '../../lib/utils';
import { eventHref, fileHref } from './noteUtils';
import { t, tn } from '../../i18n';

const todayKey = () => format(new Date(), 'yyyy-MM-dd');
const shortDate = (d: string) => fmt(parseISO(d), 'd MMM');
const longDate = (d: string) => fmt(parseISO(d), 'EEE d MMM yyyy').replace(/^./, c => c.toUpperCase());


/** Resolves a note's links, dropping the ones whose file or event no longer exists. */
function useResolvedLinks(links: NoteLink[] | undefined) {
  const items = useDrive(s => s.items);
  const events = useCalendar(s => s.events);
  return useMemo(() => {
    const out: ({ link: NoteLink; file: DriveItem } | { link: NoteLink; event: CalendarEvent })[] = [];
    for (const link of links ?? []) {
      if (link.kind === 'file') {
        const file = items.find(i => i.id === link.id && i.kind === 'file');
        if (file) out.push({ link, file });
      } else {
        const event = events.find(e => e.id === link.id);
        if (event) out.push({ link, event });
      }
    }
    return out;
  }, [links, items, events]);
}

const chip = 'group inline-flex h-7 max-w-[260px] pointer-coarse:h-[38px] items-center gap-1.5 rounded-md border border-stone-200 bg-surface pl-1.5 pr-1 text-[12px] text-stone-700 transition-colors hover:border-stone-300 hover:bg-stone-50';

export function LinkChips({ note, readOnly }: { note: Note; readOnly?: boolean }) {
  const navigate = useNavigate();
  const resolved = useResolvedLinks(note.links);
  if (!resolved.length) return null;
  const unlink = (l: NoteLink) => useNotes.getState().updateNote(note.id, { links: (note.links ?? []).filter(x => !(x.kind === l.kind && x.id === l.id)) });

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {resolved.map(r => {
        const isFile = 'file' in r;
        const title = isFile ? r.file.name : r.event.title;
        return (
          <span key={r.link.kind + r.link.id} className={chip}>
            <button
              className="flex min-w-0 items-center gap-1.5 self-stretch"
              title={isFile ? t('Ouvrir {name} dans le Drive', { name: title }) : `${title} · ${longDate(r.event.date)}`}
              onClick={() => navigate(isFile ? fileHref(r.file) : eventHref(r.event))}
            >
              {isFile ? (
                <FileIcon category={categoryOf(r.file)} size={18} />
              ) : (
                <span className="mx-1 h-2 w-2 shrink-0 rounded-full" style={{ background: catOf(r.event.category).color }} />
              )}
              <span className="truncate">{title}</span>
              {!isFile && <span className="tabular shrink-0 text-stone-500">{shortDate(r.event.date)}</span>}
            </button>
            {!readOnly && (
              <button className="hit-sm rounded p-0.5 text-stone-400 hover:bg-stone-200/70 hover:text-ink pointer-coarse:p-1.5" title={t('Retirer le lien')} aria-label={t('Retirer le lien vers «\u00a0{name}\u00a0»', { name: title })} onClick={() => unlink(r.link)}>
                <X size={12} />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function LinkPicker({ note, open, onClose }: { note: Note; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} width={520}>
      {open && <PickerBody note={note} onClose={onClose} />}
    </Modal>
  );
}

function PickerBody({ note, onClose }: { note: Note; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'all' | 'event' | 'file'>('all');
  const items = useDrive(s => s.items);
  const events = useCalendar(s => s.events);
  const links = useNotes(s => s.notes.find(n => n.id === note.id)?.links) ?? [];
  const q = normalize(query);

  const evs = useMemo(() => {
    const today = todayKey();
    const match = events.filter(e => !q || normalize(e.title).includes(q));
    const upcoming = match.filter(e => e.date >= today).sort(sortEvents);
    const past = match.filter(e => e.date < today).sort((a, b) => sortEvents(b, a));
    return [...upcoming, ...past].slice(0, q ? 40 : 12);
  }, [events, q]);

  const files = useMemo(
    () =>
      items
        .filter(i => i.kind === 'file' && (!q || normalize(i.name).includes(q)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, q ? 40 : 12),
    [items, q],
  );

  const has = (kind: NoteLink['kind'], id: string) => links.some(l => l.kind === kind && l.id === id);
  const toggle = (kind: NoteLink['kind'], id: string) =>
    useNotes.getState().updateNote(note.id, { links: has(kind, id) ? links.filter(l => !(l.kind === kind && l.id === id)) : [...links, { kind, id }] });

  const folderName = (id: string | null) => (id ? items.find(i => i.id === id)?.name : null) ?? t('Mon Drive');
  const today = todayKey();

  const row = (key: string, linked: boolean, onClick: () => void, icon: React.ReactNode, title: string, meta: React.ReactNode) => (
    <button key={key} onClick={onClick} aria-pressed={linked} className={cx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors', linked ? 'bg-brand-50/70' : 'hover:bg-stone-50')}>
      <span className="flex w-6 shrink-0 justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        <span className="block truncate text-[12px] text-stone-500">{meta}</span>
      </span>
      <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-md border', linked ? 'border-brand-solid bg-brand-solid text-on-brand' : 'border-stone-300 text-transparent')}>
        <Check size={13} strokeWidth={2.5} />
      </span>
    </button>
  );

  const showEvents = tab !== 'file';
  const showFiles = tab !== 'event';

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="text-[15px] font-semibold">{t('Lier la note')}</h3>
        <span className="text-[12px] text-stone-500">{links.length ? tn(links.length, '{n} lien', '{n} liens') : ''}</span>
      </div>
      <div className="relative mt-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
        <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Rechercher un fichier ou un événement')} aria-label={t('Rechercher un fichier ou un événement')} className="field w-full pl-8" />
      </div>
      <div className="mt-3 flex gap-1" role="group" aria-label={t('Afficher')}>
        {(
          [
            ['all', t('Tout')],
            ['event', t('Événements')],
            ['file', t('Fichiers')],
          ] as const
        ).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={cx('h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors pointer-coarse:h-9', tab === k ? 'bg-stone-100 text-ink' : 'text-stone-500 hover:text-ink')}>
            {label}
          </button>
        ))}
      </div>
      <div className="-mx-1 mt-2 max-h-[52vh] overflow-y-auto px-1">
        {showEvents && (
          <section className="mb-2">
            <p className="eyebrow px-2.5 pb-1 pt-2">{t('Événements')}</p>
            {evs.length ? (
              evs.map(e =>
                row(
                  'e' + e.id,
                  has('event', e.id),
                  () => toggle('event', e.id),
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: catOf(e.category).color }} />,
                  e.title,
                  <>
                    <span className={cx('inline-block first-letter:uppercase', e.date < today && 'text-stone-500')}>{longDate(e.date)}</span>
                    {e.start && ` · ${e.start}`} · {catOf(e.category).label}
                  </>,
                ),
              )
            ) : (
              <p className="px-2.5 py-2 text-[13px] text-stone-500">{q ? t('Aucun événement trouvé') : t('Aucun événement dans le calendrier')}</p>
            )}
          </section>
        )}
        {showFiles && (
          <section>
            <p className="eyebrow px-2.5 pb-1 pt-2">{t('Fichiers du Drive')}</p>
            {files.length ? (
              files.map(f => row('f' + f.id, has('file', f.id), () => toggle('file', f.id), <FileIcon category={categoryOf(f)} size={24} />, f.name, folderName(f.parentId)))
            ) : (
              <p className="px-2.5 py-2 text-[13px] text-stone-500">{q ? t('Aucun fichier trouvé') : t('Aucun fichier dans le Drive')}</p>
            )}
          </section>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button className="btn-primary" onClick={onClose}>
          {t('Terminé')}
        </button>
      </div>
    </div>
  );
}
