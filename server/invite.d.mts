import type { IncomingMessage, ServerResponse } from 'node:http';
export function handleInvite(req: IncomingMessage, res: ServerResponse, env?: Record<string, string | undefined>): Promise<boolean>;
export function validEmail(s: unknown): boolean;
export function inviteLinkOf(kind: 'groupe' | 'agenda', secret: string, site: string, about: { from?: string; name?: string }): string;
export const MAX_ADDRESSES: number;
