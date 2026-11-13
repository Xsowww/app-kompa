import { CalendarDays, FolderClosed, House, ListChecks, Mic, NotebookText, Users } from 'lucide-react';
import CalendarUsers from '../components/CalendarUsers';
import { useSettings } from '../store/settings';
import { resolveNavOrder, type SpaceKey } from '../lib/navOrder';
import { WORDS } from '../lib/usage';
import { t } from '../i18n';

const SPACE_COLORS = { home: 'var(--color-brand-500)', drive: '#3b6fd8', calendar: '#d9483b', notes: '#d48a17' };

export type Space = { to: string; label: string; short?: string; icon: typeof House; color: string; end?: boolean };

export const HOME: Space = { to: '/', label: t('Accueil'), icon: House, end: true, color: SPACE_COLORS.home };

/** Every space but « Accueil », shown in the person's order (settings › navOrder, lib/navOrder). `short`: in the phone's bar. */
export const SPACES: Record<SpaceKey, Space> = {
  calendrier: { to: '/calendrier', label: t('Calendrier'), icon: CalendarDays, color: SPACE_COLORS.calendar },
  taches: { to: '/taches', label: t('Tâches'), icon: ListChecks, color: '#2f9e6b' },
  notes: { to: '/notes', label: t('Notes'), icon: NotebookText, color: SPACE_COLORS.notes },
  drive: { to: '/drive', label: t('Fichiers'), icon: FolderClosed, color: SPACE_COLORS.drive },
  enregistrer: { to: '/enregistrer', label: t('Enregistrer'), icon: Mic, color: '#e5484d' },
  groupes: { to: '/groupes', label: t('Groupes'), icon: Users, color: '#1f8a8a' },
  agendas: { to: '/agendas', label: t('Agendas partagés'), short: t('Agendas||court'), icon: CalendarUsers, color: '#7a5ad6' },
};

/** A space's name for this account (« Équipes » for a work account). */
export function useSpaceLabel() {
  const usage = useSettings(s => s.usage);
  const groups = (WORDS[usage] ?? WORDS.etudes).groups;
  return (n: { to: string; label: string }) => (n.to === '/groupes' ? groups : n.label);
}

/** The spaces in the person's order (« Accueil » not in it): the one chosen, else the one the questionnaire gives. */
export function useNavOrder() {
  const saved = useSettings(s => s.navOrder);
  const usage = useSettings(s => s.usage);
  const needs = useSettings(s => s.needs);
  return resolveNavOrder(saved, usage, needs);
}
