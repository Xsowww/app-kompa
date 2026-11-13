import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareComputer, onPhone } from '../src/lib/recorder/capture';

const CHROME_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

function device({ ua, touch = 0, finger = false, screen = [1920, 1080], mobile }: { ua: string; touch?: number; finger?: boolean; screen?: [number, number] | number[]; mobile?: boolean }) {
  vi.stubGlobal('navigator', { userAgent: ua, maxTouchPoints: touch, mediaDevices: { getDisplayMedia: () => {}, getUserMedia: () => {} }, ...(mobile !== undefined && { userAgentData: { mobile } }) });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: finger && q.includes('pointer: coarse') }));
  vi.stubGlobal('screen', { width: screen[0], height: screen[1] });
}

afterEach(() => vi.unstubAllGlobals());

// « Son de l’ordinateur » is never offered where the browser can't capture it (a phone, a tablet).
describe('enregistreur : téléphone ou ordinateur', () => {
  it('un ordinateur avec Chrome : le son de l’ordinateur est proposé', () => {
    device({ ua: CHROME_PC });
    expect(onPhone()).toBe(false);
    expect(canShareComputer()).toBe(true);
  });

  it('un ordinateur tactile garde le choix (il a une souris ou un pavé)', () => {
    device({ ua: CHROME_PC, touch: 10 });
    expect(canShareComputer()).toBe(true);
  });

  it('un iPhone ou un Android, par leur nom', () => {
    device({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
    expect(onPhone()).toBe(true);
    device({ ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36' });
    expect(canShareComputer()).toBe(false);
  });

  it('un iPad qui se dit « Macintosh » mais est tactile', () => {
    device({ ua: IPAD, touch: 5 });
    expect(onPhone()).toBe(true);
  });

  it('un téléphone en « version ordinateur » : Chrome le dit, ou le doigt seul sur un petit écran', () => {
    device({ ua: CHROME_PC, mobile: true });
    expect(canShareComputer()).toBe(false);
    device({ ua: CHROME_PC, touch: 5, finger: true, screen: [393, 852] });
    expect(canShareComputer()).toBe(false);
  });

  it('une grande tablette Windows sans clavier garde le choix', () => {
    device({ ua: CHROME_PC, touch: 10, finger: true, screen: [1368, 912] });
    expect(canShareComputer()).toBe(true);
  });
});
