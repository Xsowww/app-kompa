import { Component, type ReactNode } from 'react';
import { reportError } from '../lib/reportError';
import { t } from '../i18n';

/**
 * Last safety net: an unexpected error shows this screen instead of a blank page.
 * `page`: around one page of the app (layout/AppShell): only that page gives way, the menus stay, and another
 * address (`resetKey`) tries again.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode; page?: boolean; resetKey?: string }, { failed: boolean; key?: string }> {
  state: { failed: boolean; key?: string } = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: { resetKey?: string }, state: { key?: string }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown) {
    console.error('[app]', error);
    reportError(error, this.props.page ? 'affichage (page)' : 'affichage');
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.page)
      return (
        <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6 pb-room text-center">
          <p className="text-[15px] font-semibold">{t('Cette page a rencontré un problème.')}</p>
          <p className="max-w-sm text-[13px] text-stone-500">{t('Ton travail est enregistré. Réessaie, ou va sur une autre page avec le menu.')}</p>
          <div className="mt-1 flex gap-2">
            <button className="btn-secondary h-9" onClick={() => this.setState({ failed: false })}>
              {t('Réessayer')}
            </button>
            <button className="btn-primary h-9" onClick={() => location.reload()}>
              {t('Recharger')}
            </button>
          </div>
        </div>
      );
    return (
      <div role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-paper p-6 text-center">
        <p className="text-[15px] font-semibold">{t('Oups, quelque chose s’est mal passé.')}</p>
        <p className="max-w-sm text-[13px] text-stone-500">{t('Ton travail est enregistré. Recharge la page pour continuer.')}</p>
        <button className="btn-primary mt-1 h-9" onClick={() => location.reload()}>
          {t('Recharger')}
        </button>
      </div>
    );
  }
}
