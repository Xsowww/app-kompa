import { useEffect, useState } from 'react';
import { Fingerprint, Loader2, Trash2 } from 'lucide-react';
import type { PasskeyListItem } from '@supabase/supabase-js';
import { useAuth } from '../../store/auth';
import { confirmAction, toast } from '../../store/ui';
import { passkeysAvailable } from '../../lib/supabase';
import { fmt } from '../../lib/dates';
import { relativeTime } from '../../lib/utils';
import { Section, Row } from './controls';
import { t } from '../../i18n';

/** Profile › Account: sign in with Face ID, a fingerprint or the device's code (passkeys). Hidden until switched on in Supabase. */
export default function PasskeySection() {
  const [on, setOn] = useState(false);
  const [list, setList] = useState<PasskeyListItem[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    useAuth
      .getState()
      .listPasskeys()
      .then(setList, () => setList([]));
  useEffect(() => {
    void passkeysAvailable().then(ok => {
      setOn(ok);
      if (ok) void load();
    });
  }, []);
  if (!on) return null;

  const add = async () => {
    setBusy(true);
    try {
      if (await useAuth.getState().addPasskey()) {
        toast(t('C’est prêt : la prochaine fois, connecte-toi avec Face ID ou ton empreinte.'), 'success');
        await load();
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: PasskeyListItem) => {
    if (!(await confirmAction(t('Retirer « {name} » ?', { name: p.friendly_name || t('Clé d’accès') }), t('Cet appareil ne pourra plus te connecter sans mot de passe.'), t('Retirer')))) return;
    try {
      await useAuth.getState().removePasskey(p.id);
      setList(l => l?.filter(x => x.id !== p.id) ?? null);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Section title={t('Face ID ou empreinte')} description={t('Connecte-toi sans mot de passe, avec le déverrouillage de ton appareil.')}>
      {list?.map(p => (
        <Row
          key={p.id}
          label={p.friendly_name || t('Clé d’accès')}
          hint={p.last_used_at ? (/^\d/.test(relativeTime(p.last_used_at)) ? t('Utilisée le {date}', { date: relativeTime(p.last_used_at) }) : t('Utilisée {when}', { when: relativeTime(p.last_used_at) })) : t('Ajoutée le {date}', { date: fmt(new Date(p.created_at), 'd MMM yyyy') })}
        >
          <button className="icon-btn hit" title={t('Retirer')} aria-label={t('Retirer « {name} »', { name: p.friendly_name || t('Clé d’accès') })} onClick={() => void remove(p)}>
            <Trash2 size={15} />
          </button>
        </Row>
      ))}
      <Row label={list?.length ? t('Un autre appareil ?') : t('Pas encore activé')} hint={list?.length ? t('Ouvre Kompaly dessus et ajoute-le ici.') : undefined}>
        <button className="btn-primary h-8" disabled={busy || !list} onClick={() => void add()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Fingerprint size={14} />} {t('Ajouter cet appareil')}
        </button>
      </Row>
    </Section>
  );
}
