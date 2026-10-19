import { useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { needsCredentials, savedAccounts, type SavedAccount } from '../lib/accounts';
import { useAuth } from '../store/auth';
import { confirmAction } from '../store/ui';
import { relativeTime } from '../lib/utils';
import { t } from '../i18n';

/**
 * The accounts saved on this device (except `currentId`): a click opens one, the cross forgets it here
 * and ends its kept session (the account itself is not touched). `onPick` gets the account; the caller switches or asks for its password.
 */
export default function AccountList({ currentId, onPick, busy, onEmpty }: { currentId?: string; onPick: (a: SavedAccount) => void; busy?: string | null; onEmpty?: () => void }) {
  const [list, setList] = useState(() => savedAccounts().filter(a => a.id !== currentId));
  if (!list.length) return null;
  return (
    <ul className="space-y-1.5">
      {list.map(a => {
        const locked = needsCredentials(a);
        return (
          <li key={a.id} className="group flex items-center gap-1 rounded-xl border border-stone-200 bg-surface pr-1 shadow-card transition-colors hover:border-stone-300">
            <button type="button" disabled={!!busy} onClick={() => onPick(a)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2.5 text-left disabled:opacity-60">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stone-100 text-[14px] font-semibold text-stone-700" aria-hidden>
                {(a.name || a.email).charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{a.name || a.email}</span>
                <span className="block truncate text-[12px] text-stone-500">{a.email}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-stone-500">
                {busy === a.id ? (
                  t('Ouverture…')
                ) : locked ? (
                  <>
                    <KeyRound size={12} aria-hidden /> {t('Mot de passe')}
                  </>
                ) : (
                  relativeTime(new Date(a.lastActive).toISOString())
                )}
              </span>
            </button>
            <button
              type="button"
              className="icon-btn h-7 w-7 shrink-0 pointer-coarse:h-9 pointer-coarse:w-9"
              title={t('Retirer de cet appareil')}
              aria-label={t('Retirer le compte {email} de cet appareil', { email: a.email })}
              onClick={async () => {
                if (!(await confirmAction(t('Retirer {email} de cet appareil ?', { email: a.email }), t('Ses données ne sont pas supprimées : tu pourras t’y reconnecter.'), t('Retirer')))) return;
                useAuth.getState().removeAccount(a.id);
                const rest = list.filter(x => x.id !== a.id);
                setList(rest);
                if (!rest.length) onEmpty?.();
              }}
            >
              <X size={14} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
