import { useState } from 'react';
import { Check, Plus, Tags, Trash2 } from 'lucide-react';
import { Modal } from '../../components/Overlays';
import { FieldError } from '../../components/Field';
import { confirmAction } from '../../store/ui';
import { useSettings } from '../../store/settings';
import { CATEGORIES, CATEGORY_COLORS, builtinLabel, createCategory, customNamed, deleteCategory, labelTaken, updateCategory, type CustomCategory } from '../../store/calendar';
import { AGENDA_EXAMPLES, WORDS } from '../../lib/usage';
import { useCalendarSource } from './source';
import { cx } from '../../lib/utils';
import { t, tn } from '../../i18n';

/** Said by screen readers instead of « #d48a17 » (same order as CATEGORY_COLORS). */
const COLOR_NAMES = [t('Bleu'), t('Rouge'), t('Orange'), t('Vert'), t('Violet'), t('Turquoise'), t('Rose'), t('Gris')];

export function ColorChoice({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    // Touch: 36 px dots 8 px apart, each with a 44 px tap zone (.hit).
    <div className="flex flex-wrap gap-1.5 pointer-coarse:gap-2" role="radiogroup" aria-label={t('Couleur')}>
      {CATEGORY_COLORS.map((c, i) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={t('Couleur {color}', { color: COLOR_NAMES[i] ?? c })}
          title={COLOR_NAMES[i]}
          onClick={() => onChange(c)}
          className={cx('hit flex h-6 w-6 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition pointer-coarse:h-9 pointer-coarse:w-9', value === c && 'ring-2 ring-stone-400')}
          style={{ background: c }}
        >
          {value === c && <Check size={12} strokeWidth={3} className="text-white" />}
        </button>
      ))}
    </div>
  );
}

/** Name + colour of a new category (mine, or the shared calendar's); calls back with the one created. */
export function NewCategory({ onCreated, autoFocus }: { onCreated: (c: CustomCategory) => void; autoFocus?: boolean }) {
  const { shared, categories, categoryScope: scope } = useCalendarSource();
  const used = categories.length;
  const words = { ...(WORDS[useSettings(s => s.usage)] ?? WORDS.etudes), ...(shared && AGENDA_EXAMPLES) };
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(CATEGORY_COLORS[(used + 5) % CATEGORY_COLORS.length]);
  // A name already taken: said under the field (cleared as soon as it changes).
  const [error, setError] = useState('');
  const submit = () => {
    const name = label.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const builtin = builtinLabel(name);
    if (builtin === 'current') return setError(t('« {name} » existe déjà.', { name }));
    // A name kept for the other usages (« Cours » in a work account): it would come back twice after switching.
    if (builtin === 'other') return setError(t('Kompaly garde «\u00a0{name}\u00a0» pour ses propres catégories : choisis un autre nom.', { name }));
    const same = customNamed(name, undefined, scope);
    if (same) return setError(shared ? t('L’agenda a déjà une catégorie « {name} ».', { name: same.label }) : t('Tu as déjà une catégorie « {name} ».', { name: same.label }));
    onCreated(createCategory(label, color, scope));
    setLabel('');
    setColor(CATEGORY_COLORS[(used + 6) % CATEGORY_COLORS.length]); // the next one gets another colour
  };
  return (
    <div>
      <div className="flex gap-2">
        <input
          autoFocus={autoFocus}
          value={label}
          onChange={e => (setLabel(e.target.value), setError(''))}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'new-category-err' : undefined}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t('Nom, ex. {example}', { example: words.categoryExample })}
          aria-label={t('Nom de la nouvelle catégorie')}
          data-new-category
          maxLength={24}
          className="field min-w-0 flex-1"
        />
        <button type="button" className="btn-secondary shrink-0" disabled={!label.trim()} onClick={submit}>
          <Plus size={15} /> {t('Créer')}
        </button>
      </div>
      <FieldError id="new-category-err">{error}</FieldError>
      <div className="mt-2.5">
        <ColorChoice value={color} onChange={setColor} />
      </div>
    </div>
  );
}

function Row({ cat }: { cat: CustomCategory }) {
  const [label, setLabel] = useState(cat.label);
  const [editingColor, setEditingColor] = useState(false);
  const [error, setError] = useState('');
  const { events, categoryScope: scope } = useCalendarSource();
  const count = events.filter(e => e.category === cat.id).length;
  const remove = async () => {
    const msg = count ? tn(count, 'Son événement passera dans « {category} ».', 'Ses {n} événements passeront dans « {category} ».', { category: CATEGORIES.perso.label }) : t('Aucun événement ne l’utilise.');
    if (!(await confirmAction(t('Supprimer « {title} » ?', { title: cat.label }), msg, t('Supprimer')))) return;
    deleteCategory(cat.id, scope);
    // Its row (and the button the confirmation gave the focus back to) is gone: stay in the dialog.
    setTimeout(() => document.querySelector<HTMLInputElement>('[data-new-category]')?.focus(), 0);
  };
  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setEditingColor(v => !v)} className="hit h-5 w-5 shrink-0 rounded-full ring-1 ring-stone-200" style={{ background: cat.color }} aria-label={t('Changer la couleur de « {name} »', { name: cat.label })} aria-expanded={editingColor} />
        <input
          value={label}
          onChange={e => (setLabel(e.target.value), setError(''))}
          onBlur={() => {
            if (label.trim() && !labelTaken(label, cat.id, scope)) {
              setError('');
              if (label.trim().replace(/\s+/g, ' ') !== cat.label) updateCategory(cat.id, { label }, scope);
              return setLabel(label.trim().replace(/\s+/g, ' ')); // the name as saved
            }
            // A name already taken: said under the field, which keeps it to be corrected.
            if (label.trim() && label.trim() !== cat.label) {
              return setError(builtinLabel(label) === 'other' ? t('Kompaly garde «\u00a0{name}\u00a0» pour ses propres catégories : choisis un autre nom.', { name: label.trim() }) : t('Une catégorie s’appelle déjà « {name} ».', { name: label.trim() }));
            }
            setLabel(cat.label);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `category-err-${cat.id}` : undefined}
          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label={t('Nom de la catégorie « {name} »', { name: cat.label })}
          maxLength={24}
          className="field h-8 min-w-0 flex-1"
        />
        <span className="tabular w-14 shrink-0 text-right text-[12px] text-stone-500">{count ? t('{n} év.', { n: count }) : ''}</span>
        <button type="button" onClick={() => void remove()} className="icon-btn shrink-0 hover:text-red-600" title={t('Supprimer')} aria-label={t('Supprimer la catégorie « {name} »', { name: cat.label })}>
          <Trash2 size={14} />
        </button>
      </div>
      <FieldError id={`category-err-${cat.id}`} className="pl-7">
        {error}
      </FieldError>
      {editingColor && (
        <div className="mt-2 pl-7">
          <ColorChoice
            value={cat.color}
            onChange={color => {
              updateCategory(cat.id, { color }, scope);
              setEditingColor(false);
            }}
          />
        </div>
      )}
    </li>
  );
}

/** Own calendar categories (mine, or a shared calendar's for all its members): create, rename, recolour, delete. */
export default function CategoriesDialog({ onClose }: { onClose: () => void }) {
  const { shared, categories: custom } = useCalendarSource();
  const words = { ...(WORDS[useSettings(s => s.usage)] ?? WORDS.etudes), ...(shared && AGENDA_EXAMPLES) };
  return (
    <Modal open onClose={onClose} width={460}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-stone-100 text-stone-600">
          <Tags size={15} />
        </span>
        <h3 className="text-[15px] font-semibold">{shared ? t('Catégories de l’agenda') : t('Mes catégories')}</h3>
      </div>

      <p className="eyebrow mt-5">{t('De base')}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {Object.values(CATEGORIES).map(c => (
          <span key={c.label} className="flex h-7 items-center gap-1.5 rounded-full border border-stone-200 px-2.5 text-[12px] text-stone-600">
            <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
            {c.label}
          </span>
        ))}
      </div>

      {shared && <p className="mt-2 text-[13px] text-stone-500">{t('Tous les membres de « {name} » les voient et peuvent les choisir.', { name: shared.group.name })}</p>}

      <p className="eyebrow mt-5">{shared ? t('Celles de l’agenda') : t('Les tiennes')}</p>
      {custom.length ? (
        <ul className="mt-1 divide-y divide-stone-100">
          {custom.map(c => (
            <Row key={c.id} cat={c} />
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-[13px] text-stone-500">{t('Aucune pour l’instant.')}</p>
      )}

      <div className="mt-4 rounded-lg bg-stone-50 p-3">
        <NewCategory onCreated={() => undefined} />
      </div>
      <p className="mt-2 text-[12px] text-stone-500">{t('Écris son nom dans un titre («\u00a0{example}\u00a0»)\u00a0: elle est choisie toute seule.', { example: words.categoryHint })}</p>

      <div className="mt-6 flex justify-end">
        <button className="btn-primary" onClick={onClose}>
          {t('Terminé')}
        </button>
      </div>
    </Modal>
  );
}
