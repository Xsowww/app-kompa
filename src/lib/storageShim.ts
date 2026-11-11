// A browser set to refuse site data (Chrome « Bloquer tous les cookies », some browsers inside other apps) throws as
// soon as localStorage or sessionStorage is touched: the sign-in and sign-up pages stayed on the start-up screen.
// There, a storage kept in memory takes its place for this visit: the app opens and works, and simply forgets on
// this device once the page is closed. Imported first by main.tsx, before anything reads the storage.

/** A Storage held in memory (its keys listed by Object.keys, like the real one). */
export function memoryStorage(): Storage {
  const data = new Map<string, string>();
  const api: Record<string, unknown> = {
    getItem: (k: string) => data.get(String(k)) ?? null,
    setItem: (k: string, v: string) => void data.set(String(k), String(v)),
    removeItem: (k: string) => void data.delete(String(k)),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
  };
  return new Proxy({} as Storage, {
    get: (_t, p) => (p === 'length' ? data.size : typeof p === 'string' ? (api[p] ?? data.get(p)) : undefined),
    has: (_t, p) => typeof p === 'string' && (p in api || p === 'length' || data.has(p)),
    ownKeys: () => [...data.keys()],
    getOwnPropertyDescriptor: (_t, p) => (typeof p === 'string' && data.has(p) ? { value: data.get(p), enumerable: true, configurable: true, writable: true } : undefined),
  });
}

/** Puts a memory storage where the browser's own can't be reached. Returns the names replaced. */
export function shimStorage(win: Window & typeof globalThis = window): string[] {
  const replaced: string[] = [];
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      void win[name].length;
    } catch {
      try {
        Object.defineProperty(win, name, { configurable: true, value: memoryStorage() });
        replaced.push(name);
      } catch {
        /* not replaceable here: as before */
      }
    }
  }
  return replaced;
}

if (typeof window !== 'undefined') shimStorage();
