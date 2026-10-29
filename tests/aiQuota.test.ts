import { describe, expect, it } from 'vitest';
// @ts-expect-error -- server module in plain JavaScript
import { overQuota } from '../server/copilot.mjs';

describe('overQuota with Claude', () => {
  it('stops the whole site at 250 calls a day by default (about 100 $ a month)', () => {
    const claude = { id: 'anthropic' };
    let last: string | null = null;
    for (let i = 0; i < 250; i++) last = overQuota(`eleve-${i}`, true, claude, {});
    expect(last).toBeNull();
    expect(overQuota('eleve-x', true, claude, {})).toBe('site_limit');
  });
});
