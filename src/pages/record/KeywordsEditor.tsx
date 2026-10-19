import { useState } from 'react';
import { Bell, BellOff, Plus, RotateCcw, X } from 'lucide-react';
import { useSettings } from '../../store/settings';
import { KEYWORDS_BY_USAGE, cleanKeywords, keywordsFor, parseKeywords } from '../../lib/keywords';
import { confirmAction } from '../../store/ui';
import { cx } from '../../lib/utils';
import { useRecWords } from './words';
import { t } from '../../i18n';

/** Words watched during the class: each one marked in the text, with a notification or not (the bell). */
export default function KeywordsEditor() {
  const saved = useSettings(s => s.courseKeywords);
  const usage = useSettings(s => s.usage);
  const keywords = keywordsFor(saved, usage);
  const set = (list: typeof keywords) => useSettings.getState().set({ courseKeywords: cleanKeywords(list) });
  const [text, setText] = useState('');
  const w = useRecWords();

  const add = () => {
    const words = parseKeywords(text);
    if (!words.length) return;
    set([...keywords, ...words.map(word => ({ word, notify: true }))]);
    setText('');
  };

  return (
    <div>
      <ul className="flex flex-wrap gap-1.5" aria-label={t('Mots-clés surveillés')}>
        {keywords.map(k => (
          <li key={k.word} className={cx('flex h-8 items-center rounded-full pl-1 pr-1 text-[13px] font-medium ring-1 ring-inset pointer-coarse:h-9', k.notify ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-surface text-stone-600 ring-stone-200')}>
            <button
              type="button"
              className="hit-sm flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/5"
              aria-pressed={k.notify}
              aria-label={k.notify ? t('« {word} » : notification activée', { word: k.word }) : t('« {word} » : seulement marqué', { word: k.word })}
              title={k.notify ? t('Notification activée') : t('Seulement surligné')}
              onClick={() => set(keywords.map(x => (x.word === k.word ? { ...x, notify: !x.notify } : x)))}
            >
              {k.notify ? <Bell size={13} /> : <BellOff size={13} className="text-stone-400" />}
            </button>
            <span className="px-1">{k.word}</span>
            <button type="button" className="hit-sm flex h-6 w-6 items-center justify-center rounded-full text-stone-500 hover:bg-black/5 hover:text-ink" aria-label={t('Retirer « {word} »', { word: k.word })} onClick={() => set(keywords.filter(x => x.word !== k.word))}>
              <X size={13} />
            </button>
          </li>
        ))}
        {!keywords.length && <li className="text-[13px] text-stone-500">{t('Aucun mot-clé : rien ne sera signalé.')}</li>}
      </ul>
      <div className="mt-2.5 flex gap-2">
        <input
          className="field h-9 min-w-0 flex-1"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={w.keywordHint}
          aria-label={t('Ajouter un mot-clé')}
          maxLength={120}
        />
        <button type="button" className="btn-secondary h-9" onClick={add} disabled={!text.trim()}>
          <Plus size={15} /> {t('Ajouter')}
        </button>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed">
        <button
          type="button"
          className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
          onClick={async () => (await confirmAction(t('Remettre la liste par défaut ?'), t('Tes mots-clés ajoutés seront retirés.'), t('Remettre'), false)) && set(KEYWORDS_BY_USAGE[usage] ?? KEYWORDS_BY_USAGE.etudes)}
        >
          <RotateCcw size={11} aria-hidden /> {t('Liste par défaut')}
        </button>
      </p>
    </div>
  );
}
