import { describe, expect, it } from 'vitest';
// @ts-expect-error -- server module in plain JavaScript
import { overQuota } from '../server/copilot.mjs';

describe('overQuota with Claude', () => {
  it('stops the whole site at 1500 calls a day by default', () => {
    const claude = { id: 'anthropic' };
    let last: string | null = null;
    for (let i = 0; i < 1500; i++) last = overQuota(`eleve-${i}`, true, claude, {});
    expect(last).toBeNull();
    expect(overQuota('eleve-x', true, claude, {})).toBe('site_limit');
  });
});

describe('quotaOf', () => {
  it('counts only questions, capped at the daily limit', async () => {
    // @ts-expect-error -- server module in plain JavaScript
    const { overQuota: count, quotaOf } = await import('../server/copilot.mjs');
    const claude = { id: 'anthropic' };
    const env = { AI_DAILY_QUESTIONS: '3', AI_DAILY_BUDGET: '100000' };
    count('lina', true, claude, env);
    count('lina', false, claude, env); // a tool call inside the same question
    expect(quotaOf('lina', env)).toEqual({ used: 1, max: 3 });
    count('lina', true, claude, env);
    count('lina', true, claude, env);
    expect(count('lina', true, claude, env)).toBe('daily_limit');
    expect(quotaOf('lina', env)).toEqual({ used: 3, max: 3 });
    expect(quotaOf('personne', env)).toEqual({ used: 0, max: 3 });
  });
});
