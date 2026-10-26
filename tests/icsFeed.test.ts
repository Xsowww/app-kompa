import { describe, expect, it } from 'vitest';
import { feedUrl, isPublicAddress, fetchFeed } from '../server/icsFeed.mjs';

describe('abonnement par lien : adresses refusées', () => {
  it('only public http(s) links', () => {
    expect(feedUrl('webcal://edt.univ.fr/cal.ics')?.href).toBe('https://edt.univ.fr/cal.ics');
    expect(feedUrl('https://calendar.google.com/calendar/ical/x/basic.ics')).not.toBeNull();
    for (const bad of ['file:///etc/passwd', 'ftp://a.fr/x.ics', 'http://localhost/x', 'http://127.0.0.1/x', 'http://10.0.0.2/x', 'http://[::1]/x', 'http://169.254.169.254/latest', 'https://a.fr:8080/x', 'https://user:pw@a.fr/x', 'http://intranet.local/x', 'pas un lien'])
      expect(feedUrl(bad), bad).toBeNull();
  });
  it('private addresses, also written as IPv6', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('192.168.1.1')).toBe(false);
    for (const a of ['::7f00:1', '::ffff:0:7f00:1', '2002:7f00:1::', '64:ff9b:1::7f00:1']) expect(isPublicAddress(a)).toBe(false);
    expect(isPublicAddress('2a01:cb00::1')).toBe(true);
    expect(isPublicAddress('::ffff:10.0.0.1')).toBe(false);
    expect(isPublicAddress('fd00::1')).toBe(false);
    expect(isPublicAddress('2606:4700::1')).toBe(true);
  });
  it('a name that resolves to a private address is refused at connection', async () => {
    await expect(fetchFeed('http://localhost.localtest.me/x.ics')).rejects.toMatchObject({});
    await expect(fetchFeed('http://127.0.0.1.nip.io/x.ics')).rejects.toMatchObject({});
  });
});
