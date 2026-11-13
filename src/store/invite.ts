import { create } from 'zustand';

/** The « Inviter » window open (pages/groups/InviteDialog, in AppShell): a group's code or a shared calendar's link. */
export interface InviteOpen {
  /** The group's id (« Inviter par e-mail »: the server checks my right to invite). */
  id?: string;
  kind: 'groupe' | 'agenda';
  name: string;
  secret: string;
}

export const useInvite = create<{ invite: InviteOpen | null }>()(() => ({ invite: null }));
