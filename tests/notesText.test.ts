import { describe, expect, it } from 'vitest';
import { stripHtml } from '../src/lib/utils';
import { withProtocol } from '../src/pages/notes/noteUtils';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { useNotes } = await import('../src/store/notes');

describe('stripHtml', () => {
  it('decodes HTML entities', () => {
    expect(stripHtml('<p>Les molécules &amp; atomes. Ion &lt; atome.</p><p>&quot;x&quot;&nbsp;&#39;y&#x27; &amp;lt;</p>')).toBe('Les molécules & atomes. Ion < atome. "x" \'y\' &lt;');
  });
  it('leaves unknown entities alone', () => {
    expect(stripHtml('a &foo; b')).toBe('a &foo; b');
  });
  it('keeps a word whole across formatting, separates blocks', () => {
    expect(stripHtml('<p>Le théo<strong>rème</strong> de l’<mark>ADN</mark> <a href="x">lien</a>s</p>')).toBe('Le théorème de l’ADN liens');
    expect(stripHtml('<p>un</p><p>deux<br>trois</p><ul><li><p>quatre</p></li></ul><table><tr><td>a</td><td>b</td></tr></table>')).toBe('un deux trois quatre a b');
    expect(stripHtml('<h2>Titre</h2><blockquote><p>cit</p></blockquote><img src="x">fin')).toBe('Titre cit fin');
  });
});

describe('withProtocol', () => {
  it('adds https:// to a bare address', () => {
    expect(withProtocol(' kompaly.com ')).toBe('https://kompaly.com');
    expect(withProtocol('localhost:5191/x')).toBe('https://localhost:5191/x');
  });
  it('keeps full addresses, mail links and anchors', () => {
    expect(withProtocol('http://a.fr')).toBe('http://a.fr');
    expect(withProtocol('mailto:a@b.fr')).toBe('mailto:a@b.fr');
    expect(withProtocol('a@b.fr')).toBe('mailto:a@b.fr');
    expect(withProtocol('#titre')).toBe('#titre');
  });
  it('never keeps a script or data link', () => {
    expect(withProtocol('javascript://x%0aalert(1)')).toBe('https://javascript://x%0aalert(1)');
    expect(withProtocol('data://text/html,x')).toMatch(/^https:\/\//);
  });
});

describe('moveFolder', () => {
  it('renames a folder moved next to one with the same name', () => {
    useNotes.setState({ folders: [], notes: [] });
    const s = useNotes.getState();
    const maths = s.createFolder('Maths', null);
    s.createFolder('Algèbre', maths.id);
    const root = s.createFolder('Algèbre', null);
    useNotes.getState().moveFolder(root.id, maths.id);
    const names = useNotes.getState().folders.filter(f => f.parentId === maths.id).map(f => f.name).sort();
    expect(names).toEqual(['Algèbre', 'Algèbre (2)']);
  });
  it('keeps the name when the folder stays where it is', () => {
    useNotes.setState({ folders: [], notes: [] });
    const f = useNotes.getState().createFolder('Physique', null);
    useNotes.getState().moveFolder(f.id, null);
    expect(useNotes.getState().folders[0].name).toBe('Physique');
  });
});
