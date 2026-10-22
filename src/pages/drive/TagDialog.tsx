import { useMemo, useRef, useState } from 'react';
import { Plus, Tag, X } from 'lucide-react';
import { Modal } from '../../components/Overlays';
import { useDrive, FOLDER_COLORS } from '../../store/drive';
import { cx } from '../../lib/utils';
import { useSettings } from '../../store/settings';
import { usageWords } from '../../lib/usage';
import { t, tn, locale } from '../../i18n';

const PALETTE = Object.values(FOLDER_COLORS).map(c => c.color);

/** Same label, same colour, everywhere. */
function tagColor(tag: string) {
  let h = 0;
  for (const c of tag.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function TagPill({ tag, active, onClick, onRemove, size = 'sm' }: { tag: string; active?: boolean; onClick?: () => void; onRemove?: () => void; size?: 'sm' | 'md' }) {
  const Comp = onClick ? 'button' : 'span';
  return (
    <Comp
      onClick={onClick}
      className={cx(
        'inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full border font-medium transition-colors',
        size === 'md' ? 'h-7 px-2.5 text-[12px] pointer-coarse:h-9' : 'h-[18px] px-1.5 text-[10.5px]',
        onClick && size === 'md' && 'hit',
        active ? 'border-ink bg-ink text-paper' : 'border-stone-200 bg-surface text-stone-600',
        onClick && !active && 'hover:border-stone-300 hover:text-ink',
      )}
    >
      <span className={cx('shrink-0 rounded-full', size === 'md' ? 'h-2 w-2' : 'h-1.5 w-1.5')} style={{ background: tagColor(tag) }} />
      <span className="truncate">{tag}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={t('Retirer l’étiquette « {tag} »', { tag })}
          title={t('Retirer')}
          onClick={e => {
            e.stopPropagation();
            onRemove();
          }}
          className="hit -my-1 -mr-1.5 flex h-6 w-6 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100 hover:text-ink pointer-coarse:h-9 pointer-coarse:w-9"
        >
          <X size={11} />
        </button>
      )}
    </Comp>
  );
}

/** Add / remove labels on one or several items. Changes apply immediately. */
export default function TagDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const items = useDrive(s => s.items);
  const targets = items.filter(i => ids.includes(i.id));
  const [draft, setDraft] = useState('');
  const usage = useSettings(s => s.usage);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = [...new Set(targets.flatMap(i => i.tags ?? []))].sort((a, b) => a.localeCompare(b, locale()));
  const known = useMemo(() => [...new Set(items.flatMap(i => i.tags ?? []))].sort((a, b) => a.localeCompare(b, locale())), [items]);
  const suggestions = known.filter(k => !current.includes(k) && k.toLowerCase().includes(draft.trim().toLowerCase())).slice(0, 8);

  const setTags = (fn: (tags: string[]) => string[]) => {
    for (const it of targets) {
      const next = fn(it.tags ?? []);
      useDrive.getState().update(it.id, { tags: next.length ? next : undefined });
    }
  };
  const add = (raw: string) => {
    const tag = raw.trim().replace(/\s+/g, ' ').slice(0, 32);
    if (!tag) return;
    // Reuse the existing spelling of a label ("important" → "Important").
    const existing = known.find(k => k.toLowerCase() === tag.toLowerCase()) ?? tag;
    setTags(tags => (tags.some(x => x.toLowerCase() === existing.toLowerCase()) ? tags : [...tags, existing]));
    setDraft('');
  };
  const remove = (tag: string) => {
    setTags(tags => tags.filter(x => x !== tag));
    // The × disappears with its label: keep the keyboard focus in the dialog.
    inputRef.current?.focus();
  };

  return (
    <Modal open onClose={onClose} width={420}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-stone-100 text-stone-600">
          <Tag size={15} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">{t('Étiquettes')}</h3>
          <p className="truncate text-[12px] text-stone-500">{targets.length === 1 ? targets[0].name : tn(targets.length, '{n} élément', '{n} éléments')}</p>
        </div>
      </div>

      <div className="mt-4 flex min-h-8 flex-wrap gap-1.5">
        {current.length ? current.map(tag => <TagPill key={tag} tag={tag} size="md" onRemove={() => remove(tag)} />) : <p className="text-[13px] text-stone-500">{t('Aucune étiquette pour l’instant.')}</p>}
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={e => {
          e.preventDefault();
          add(draft);
        }}
      >
        <input ref={inputRef} autoFocus value={draft} onChange={e => setDraft(e.target.value)} aria-label={t('Nouvelle étiquette')} placeholder={t('ex. {example}', { example: usageWords(usage).tagExample })} className="field min-w-0 flex-1" maxLength={32} />
        <button type="submit" className="btn-secondary" disabled={!draft.trim()}>
          <Plus size={15} /> {t('Ajouter')}
        </button>
      </form>

      {suggestions.length > 0 && (
        <div className="mt-4">
          <p className="eyebrow">{t('Déjà utilisées')}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {suggestions.map(tag => (
              <TagPill key={tag} tag={tag} size="md" onClick={() => add(tag)} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button className="btn-primary" onClick={onClose}>
          {t('Terminé')}
        </button>
      </div>
    </Modal>
  );
}
