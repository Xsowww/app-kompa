import { useEffect, useState } from 'react';
import { serverState } from '../../lib/recorder/api';

/** Is the photo reading set up on the server? Asked once. */
let ready: Promise<boolean> | null = null;
export function usePhotoReady() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let live = true;
    (ready ??= serverState().then(s => !!s.photo).catch(() => ((ready = null), false))).then(v => live && setOk(v));
    return () => {
      live = false;
    };
  }, []);
  return ok;
}
