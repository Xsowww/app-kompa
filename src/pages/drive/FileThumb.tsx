import { useEffect, useRef, useState, type ReactNode } from 'react';
import { canThumb, thumbUrl } from './thumbs';
import type { DriveItem } from '../../store/drive';
import { cx } from '../../lib/utils';

/**
 * A file's small picture (an image, a PDF's first page) once its tile comes near the screen, its icon meanwhile and
 * for every other file. Give it a `key` per version of the file (thumbKey) so that a changed file starts again.
 */
export default function FileThumb({ item, icon, className }: { item: DriveItem; icon: ReactNode; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const can = canThumb(item);
  useEffect(() => {
    const el = ref.current;
    if (!can || !el) return;
    let alive = true;
    const io = new IntersectionObserver(
      entries => {
        if (!entries.some(e => e.isIntersecting)) return;
        io.disconnect();
        void thumbUrl(item).then(u => alive && setUrl(u));
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per version of the file (the caller's key)
  }, [can]);
  return (
    <span ref={ref} className="flex shrink-0 items-center justify-center">
      {/* A PDF shows the top of its first page (its title). */}
      {url ? <img src={url} alt="" draggable={false} className={cx('rounded-md bg-white object-cover ring-1 ring-stone-200', item.mime === 'application/pdf' || /\.pdf$/i.test(item.name) ? 'object-top' : '', className)} /> : icon}
    </span>
  );
}
