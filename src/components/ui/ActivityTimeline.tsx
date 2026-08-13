import type { ActivityEvent } from '@/types';
import { formatDateTime } from '@/lib/format';

export function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-surface-400">No activity recorded yet.</p>;
  }
  const sorted = [...events].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <ol className="relative space-y-4 border-l border-surface-200 pl-5">
      {sorted.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[1.55rem] top-1 flex h-3 w-3 items-center justify-center">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-500 ring-1 ring-brand-200" />
          </span>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-sm font-medium text-surface-800">{e.action}</p>
            <time className="text-xs text-surface-400">{formatDateTime(e.date)}</time>
          </div>
          {e.detail && <p className="mt-0.5 text-sm text-surface-500">{e.detail}</p>}
          <p className="mt-0.5 text-xs text-surface-400">by {e.actor}</p>
        </li>
      ))}
    </ol>
  );
}
