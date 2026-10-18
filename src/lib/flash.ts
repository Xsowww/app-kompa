// « It's here »: the item a link or a shortcut leads to glows for a few seconds once on screen
// (a task from « Ma semaine », an event from the home page or a search, a note…), once, softly.

const CLASS = 'flash-target';

/** Brings the element into view and lights it up (again, if it already was). */
export function flash(el: Element | null | undefined) {
  if (!(el instanceof HTMLElement)) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduce-motion');
  el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  el.classList.remove(CLASS);
  void el.offsetWidth; // restart the animation
  el.classList.add(CLASS);
  setTimeout(() => el.classList.remove(CLASS), 1700);
}

/** The same, once the element is there (pages and lists draw a moment after the navigation). */
export function flashWhenReady(find: () => Element | null | undefined, tries = 30) {
  const el = find();
  if (el) return flash(el);
  if (tries > 0) setTimeout(() => flashWhenReady(find, tries - 1), 100);
}
