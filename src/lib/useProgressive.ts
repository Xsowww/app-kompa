import { startTransition, useEffect, useState } from 'react';

/**
 * A long list shows its first rows at once and the rest a moment later, when the browser is free:
 * the page appears without waiting for hundreds of rows. Once whole, it stays whole (a row added
 * later shows at once). Returns how many rows to render.
 */
export function useProgressive(total: number, first = 40) {
  const [full, setFull] = useState(total <= first);
  useEffect(() => {
    if (full) return;
    const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 60));
    const cancel = window.cancelIdleCallback ?? clearTimeout;
    const id = idle(() => startTransition(() => setFull(true)), { timeout: 400 });
    return () => cancel(id as number);
  }, [full]);
  return full ? total : Math.min(total, first);
}
