import { t } from '../../i18n';
/** Images are stored inline in the note HTML (data URLs), so they must stay small. */
export const IMAGE_MAX_SIDE = 1600;
export const IMAGE_MAX_BYTES = 400 * 1024;

const dataUrlBytes = (url: string) => Math.ceil(((url.length - url.indexOf(',') - 1) * 3) / 4);

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t('Image illisible')));
    };
    img.src = url;
  });
}

function draw(img: HTMLImageElement, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/**
 * Resizes an image (longest side ≤ 1600 px) and returns a data URL:
 * PNG when it has transparency, JPEG otherwise. Throws with a French message when it stays too big.
 */
export async function compressImage(file: Blob): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error(t('Ce fichier n’est pas une image'));
  const img = await loadImage(file);
  const mayBeTransparent = /png|webp|gif|svg/.test(file.type);

  for (const side of [IMAGE_MAX_SIDE, 1200, 900]) {
    const { canvas, ctx } = draw(img, side);
    if (mayBeTransparent) {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (hasTransparency(ctx, canvas.width, canvas.height)) {
        const png = canvas.toDataURL('image/png');
        if (dataUrlBytes(png) <= IMAGE_MAX_BYTES) return png;
        continue;
      }
    }
    // JPEG has no alpha: paint a white background first.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.82, 0.72, 0.6]) {
      const jpg = canvas.toDataURL('image/jpeg', q);
      if (dataUrlBytes(jpg) <= IMAGE_MAX_BYTES) return jpg;
    }
  }
  throw new Error(t('Image trop lourde, même compressée (400 Ko au maximum).'));
}

export const imageFiles = (list: FileList | null | undefined) => Array.from(list ?? []).filter(f => f.type.startsWith('image/'));
