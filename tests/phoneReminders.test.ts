import { describe, expect, it } from 'vitest';
import { deviceWord, freshReminder, reminderDevice, unblockSteps } from '../src/lib/phoneReminders';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const ANDROID_TAB = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';

const dev = (userAgent: string, standalone = false, touchPoints = 0) => reminderDevice({ userAgent, standalone, touchPoints });

describe('quel appareil', () => {
  it('iPhone dans Safari, ou ouvert depuis son icône', () => {
    expect(dev(IPHONE)).toBe('ios-browser');
    expect(dev(IPHONE, true)).toBe('ios-app');
  });
  it('un iPad se dit « Macintosh » mais a un écran tactile', () => {
    expect(dev(IPAD_DESKTOP, false, 5)).toBe('ios-browser');
    expect(dev(IPAD_DESKTOP, false, 0)).toBe('computer');
  });
  it('Android, ordinateur', () => {
    expect(dev(ANDROID)).toBe('android');
    expect(dev(WINDOWS)).toBe('computer');
  });
  it('le mot pour le dire', () => {
    expect(deviceWord('ios-browser', IPHONE)).toBe('ce téléphone');
    expect(deviceWord('ios-browser', IPAD_DESKTOP, 5)).toBe('cette tablette');
    expect(deviceWord('android', ANDROID)).toBe('ce téléphone');
    expect(deviceWord('android', ANDROID_TAB)).toBe('cette tablette');
    expect(deviceWord('computer', WINDOWS)).toBe('cet ordinateur');
  });
});

describe('notifications refusées : les étapes de chaque appareil', () => {
  it('jamais le « cadenas » sur un téléphone', () => {
    for (const [d, ua] of [['ios-app', IPHONE], ['android', ANDROID]] as const) {
      const steps = unblockSteps(d, ua);
      expect(steps).toHaveLength(3);
      expect(steps.join(' ')).not.toMatch(/cadenas|adresse/);
    }
    expect(unblockSteps('ios-app', IPHONE)[0]).toMatch(/Réglages de l’iPhone/);
    expect(unblockSteps('android', ANDROID)[0]).toMatch(/Chrome/);
  });
  it('sur ordinateur, selon le navigateur', () => {
    expect(unblockSteps('computer', WINDOWS).join(' ')).toMatch(/réglages du site/);
    expect(unblockSteps('computer', FIREFOX).join(' ')).toMatch(/blocage/);
    expect(unblockSteps('computer', IPAD_DESKTOP).join(' ')).toMatch(/Safari › Réglages/);
  });
});

describe('le premier rappel fait apparaître l’offre', () => {
  const now = Date.parse('2026-11-06T15:00:00Z');
  const at = (sAgo: number) => new Date(now - sAgo * 1000).toISOString();
  it('un rappel tout juste créé', () => {
    expect(freshReminder([{ reminders: [15], createdAt: at(3) }], now)).toBe(true);
  });
  it('pas sans rappel, pas un import, pas un vieux', () => {
    expect(freshReminder([{ reminders: [], createdAt: at(3) }], now)).toBe(false);
    expect(freshReminder([{ createdAt: at(3) }], now)).toBe(false);
    expect(freshReminder([{ reminders: [15], createdAt: at(3), externalId: 'x@google' }], now)).toBe(false);
    expect(freshReminder([{ reminders: [15], createdAt: at(600) }], now)).toBe(false);
    expect(freshReminder([{ reminders: [15] }], now)).toBe(false);
  });
});
