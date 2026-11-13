import type { IncomingMessage, ServerResponse } from 'node:http';

export function handlePush(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
export function startPushLoop(): void;
export interface ReminderRow { key: string; user_id: string; title: string; body: string | null; url: string; fire_at: string }
export interface TodoRow { id: string; user_id: string; title: string; done: boolean; due: string | null; deleted_at?: string | null; created_at?: string }
export function freshTaskRows<T extends ReminderRow>(rows: T[], todos: TodoRow[], langs?: Map<string, string>): T[];
export function pushEndpointOk(endpoint: string): boolean;
export const pushStatus: { active: boolean; lastRun: string | null; lastError: string | null; lastCode: number | string | null; lastHint: string | null; sent: number };
export const keyKind: string;
