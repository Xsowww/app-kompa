// Encodes the pieces of a class away from the page: 0.5 to 1.6 s per piece on a phone froze scrolling and buttons.
import { encodeFlac } from './flac';

self.onmessage = (e: MessageEvent<{ id: number; samples: Float32Array }>) => postMessage({ id: e.data.id, blob: encodeFlac(e.data.samples) });
