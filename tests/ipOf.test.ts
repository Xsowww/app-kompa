import { describe, expect, it } from 'vitest';
// @ts-expect-error -- server module in plain JavaScript
import { ipOf, rateLimited } from '../server/copilot.mjs';

const req = (xff: string, cf?: string) => ({ headers: { 'x-forwarded-for': xff, ...(cf ? { 'cf-connecting-ip': cf } : {}) }, socket: { remoteAddress: '10.0.0.1' } });
const env = { RENDER: 'true' };

describe('ipOf', () => {
  it('reads CF-Connecting-IP when the request comes from Cloudflare', () => {
    expect(ipOf(req('1.2.3.4, 172.70.1.2', '81.5.6.7'), env)).toBe('81.5.6.7');
    expect(ipOf(req('2606:4700:10::1', '2a01::5'), env)).toBe('2a01:0:0:0::/64');
    expect(ipOf(req('2606:4700:10::1', '2a01:db8:1:2:aaaa::9'), env)).toBe('2a01:db8:1:2::/64');
  });
  it('ignores a CF-Connecting-IP sent from anywhere else', () => {
    expect(ipOf(req('81.5.6.7', '9.9.9.9'), env)).toBe('81.5.6.7');
  });
  it('keeps the last X-Forwarded-For address without Cloudflare', () => {
    expect(ipOf(req('6.6.6.6, 81.5.6.7'), env)).toBe('81.5.6.7');
    expect(ipOf(req('172.70.1.2'), env)).toBe('172.70.1.2');
  });
  it('uses the socket outside a proxy', () => {
    expect(ipOf(req('172.70.1.2', '9.9.9.9'), {})).toBe('10.0.0.1');
  });
  it('a flood of addresses never lifts an account limit', () => {
    for (let i = 0; i < 3; i++) rateLimited('user:flood', 2);
    expect(rateLimited('user:flood', 2)).toBe(true);
    for (let i = 0; i < 10_100; i++) rateLimited(`ip:10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`, 40);
    expect(rateLimited('user:flood', 2)).toBe(true);
  });
});
