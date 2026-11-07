import { memo, useMemo } from 'react';
import { frenchSpacing, parseMarkdown, type Inline } from './markdown';

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <span key={i}>{frenchSpacing(n.v)}</span>;
          case 'code':
            return (
              <code key={i} className="rounded bg-stone-900/[0.07] px-1 py-px font-mono text-[0.92em]">
                {n.v}
              </code>
            );
          case 'strong':
            return (
              <strong key={i} className="font-semibold">
                <Inlines nodes={n.c} />
              </strong>
            );
          case 'em':
            return (
              <em key={i}>
                <Inlines nodes={n.c} />
              </em>
            );
          case 'br':
            return <br key={i} />;
        }
      })}
    </>
  );
}

/**
 * Kompaly's answers with light formatting. Everything is rendered as React text: no HTML injection possible.
 * memo: the conversation is drawn again on each change of page; its messages are not.
 */
export default memo(function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="space-y-2 break-words">
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'p':
            return (
              <p key={i}>
                <Inlines nodes={b.c} />
              </p>
            );
          case 'h':
            return (
              <p key={i} className="pt-1 font-semibold text-ink">
                <Inlines nodes={b.c} />
              </p>
            );
          case 'quote':
            return (
              <p key={i} className="border-l-2 border-stone-300 pl-2.5 text-stone-600">
                <Inlines nodes={b.c} />
              </p>
            );
          case 'code':
            return (
              <pre key={i} className="overflow-x-auto rounded-lg bg-[var(--code-block)] px-3 py-2 font-mono text-[12px] leading-[1.55] text-[#e7e5e4]">
                <code>{b.v}</code>
              </pre>
            );
          case 'ul':
            return (
              <ul key={i} className="list-disc space-y-1 pl-4 marker:text-stone-400">
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inlines nodes={it} />
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} start={b.start} className="list-decimal space-y-1 pl-5 marker:text-stone-500">
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inlines nodes={it} />
                  </li>
                ))}
              </ol>
            );
        }
      })}
    </div>
  );
});
