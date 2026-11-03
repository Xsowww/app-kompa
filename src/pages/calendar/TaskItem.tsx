import { Check, ListTodo } from 'lucide-react';
import { useTodos, type Todo } from '../../store/todos';
import { cx } from '../../lib/utils';
import { t } from '../../i18n';

/** A square box (a task), not the round one of an event: ticked here as in Tâches. */
function TaskBox({ todo, size = 14 }: { todo: Todo; size?: number }) {
  return (
    <button
      type="button"
      onPointerDown={e => e.stopPropagation()}
      onClick={e => {
        e.stopPropagation();
        useTodos.getState().toggle(todo.id);
      }}
      className={cx('hit-sm flex shrink-0 items-center justify-center rounded-[4px] border-[1.5px] transition-colors', todo.done ? 'border-ink bg-ink' : 'border-stone-400 hover:border-stone-600')}
      style={{ width: size, height: size }}
      title={todo.done ? t('Marquer comme à faire') : t('Marquer comme fait')}
      aria-label={todo.done ? t('Remettre « {title} » à faire', { title: todo.title }) : t('Marquer « {title} » comme fait', { title: todo.title })}
    >
      {todo.done && <Check size={size - 5} strokeWidth={3} className="text-paper" />}
    </button>
  );
}

/** A task in a small space (the « Journée » row, a month cell): its box and its title, lighter than an event. */
export function TaskChip({ todo, onOpen, className, wrap }: { todo: Todo; onOpen: (todo: Todo) => void; className?: string; /** Two lines of title (a week's narrow column). */ wrap?: boolean }) {
  return (
    <span
      className={cx(
        'flex min-w-0 max-w-full gap-1.5 rounded-md border border-dashed border-stone-300 px-1.5 text-[12px] text-stone-600',
        wrap ? 'min-h-6 items-start py-[3px] leading-4 pointer-coarse:min-h-9 pointer-coarse:items-center' : 'h-6 items-center pointer-coarse:h-9',
        todo.done && 'opacity-60',
        className,
      )}
    >
      <span className={cx('flex shrink-0', wrap && 'mt-px pointer-coarse:mt-0')}>
        <TaskBox todo={todo} size={13} />
      </span>
      <button type="button" onClick={() => onOpen(todo)} className={cx('min-w-0 flex-1 text-left', !wrap && 'truncate', todo.done && 'line-through')} title={t('Tâche · {title}', { title: todo.title })}>
        <span className={cx(wrap && 'line-clamp-2 hyphens-auto [overflow-wrap:break-word]')}>
          {todo.time && <span className="tabular text-stone-500">{todo.time} </span>}
          {todo.title}
        </span>
      </button>
    </span>
  );
}

/** A task in a day's list, under its events: the same row shape, a square box, « Tâche » under the title. */
export function TaskRow({ todo, onOpen }: { todo: Todo; onOpen: (todo: Todo) => void }) {
  return (
    <div className="flex items-stretch gap-2 sm:gap-4">
      <div className="tabular w-10 shrink-0 pt-3 text-right text-[12px] text-stone-500 sm:w-12">{todo.time ?? ''}</div>
      <div data-task={todo.id} className={cx('flex min-w-0 flex-1 items-start gap-3 rounded-[16px] border border-dashed border-stone-200 py-3 pl-3 pr-2', todo.done && 'opacity-60')}>
        <span className="mt-0.5">
          <TaskBox todo={todo} size={18} />
        </span>
        <button type="button" className="min-w-0 flex-1 text-left pointer-coarse:py-2" onClick={() => onOpen(todo)}>
          <p className={cx('text-[14px] font-medium leading-snug [overflow-wrap:anywhere]', todo.done && 'text-stone-500 line-through')}>{todo.title}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[12px] text-stone-500">
            <ListTodo size={11} aria-hidden /> {t('Tâche')}
          </p>
        </button>
      </div>
    </div>
  );
}
