import type { IncomingMessage, ServerResponse } from 'node:http';
export function handleCours(req: IncomingMessage, res: ServerResponse, env?: Record<string, string | undefined>): Promise<boolean>;
