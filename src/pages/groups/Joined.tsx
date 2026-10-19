import { useNavigate } from 'react-router-dom';
import { CalendarRange, Users } from 'lucide-react';
import { Modal } from '../../components/Overlays';
import { AGENDA_WORDS, groupWords } from '../../lib/usage';
import { useSettings } from '../../store/settings';
import { useJoined } from './join';
import { t } from '../../i18n';

/** The window itself (in AppShell, over every page). */
export function JoinedDialog() {
  const joined = useJoined(s => s.joined);
  const usage = useSettings(s => s.usage);
  const navigate = useNavigate();
  const close = () => useJoined.setState({ joined: null });
  if (!joined) return null;
  const w = joined.kind === 'agenda' ? AGENDA_WORDS : groupWords(usage);
  const name = joined.name ? t('« {name} »', { name: joined.name }) : w.the;
  const Icon = joined.kind === 'agenda' ? CalendarRange : Users;
  return (
    <Modal open onClose={close}>
      <div className="flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Icon size={22} />
        </span>
        <h3 className="mt-3 text-[16px] font-semibold [overflow-wrap:anywhere]">{joined.already ? t('Tu fais déjà partie de {name}', { name }) : t('Tu as rejoint {name}', { name })}</h3>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary justify-center" onClick={close}>
          {t('Terminer')}
        </button>
        <button
          type="button"
          className="btn-primary justify-center"
          onClick={() => {
            close();
            navigate(joined.kind === 'agenda' ? `/agendas?g=${joined.id}` : `/groupes?g=${joined.id}`);
          }}
        >
          {t('Y aller')}
        </button>
      </div>
    </Modal>
  );
}
