import type { RecentActivityItem } from "@openvuln/shared";
import { formatRelativeTime } from "../shared/lib/format";

const ROW_H = 28; // px，无缝滚动依赖统一行高
const VISIBLE = 3;

function badge(r: RecentActivityItem) {
  if (r.type === "project_submitted") {
    return (
      <span className="shrink-0 rounded bg-accent-50 px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-wide text-accent-700">
        New project
      </span>
    );
  }
  if (r.type === "disclosed") {
    return (
      <span className="shrink-0 rounded bg-ai-bg px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-wide text-ai-ink">
        Disclosed · {r.meta}
      </span>
    );
  }
  // scan_completed with findings
  return (
    <span className="shrink-0 rounded bg-sev-high-bg px-1.5 py-px font-mono text-[10px] font-semibold text-sev-high-ink">
      {(r.meta ?? "").replace(" findings", "")} findings
    </span>
  );
}

/** 欢迎页滚动信息流（无边框、左右透明渐变）：new project / new finding 摘要，无缝纵滚，hover 暂停 */
export function EventTicker({ events }: { events: RecentActivityItem[] | undefined }) {
  const items = (events ?? [])
    .filter(
      (r) =>
        r.type === "project_submitted" ||
        r.type === "disclosed" ||
        (r.type === "scan_completed" && r.meta && !r.meta.startsWith("+0")),
    )
    .slice(0, 8);

  if (items.length === 0) return null;

  const row = (r: RecentActivityItem, key: string) => (
    <li key={key} className="flex items-center gap-2.5 text-[13px]" style={{ height: ROW_H }}>
      {badge(r)}
      <span className="min-w-0 truncate text-ink">{r.full_name ?? r.text}</span>
      <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-tertiary">
        {formatRelativeTime(r.ts)}
      </span>
    </li>
  );

  return (
    <div data-ticker aria-label="Live activity feed">
      <div
        className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]"
        style={{ height: ROW_H * VISIBLE }}
      >
        <ul
          className="ticker-track px-8"
          style={{ animation: `ticker-y ${Math.max(8, items.length * 2.4)}s linear infinite` }}
        >
          {items.map((r, i) => row(r, `a-${i}`))}
          {items.map((r, i) => row(r, `b-${i}`))}
        </ul>
      </div>
      <style>{`
        @keyframes ticker-y { to { transform: translateY(-50%); } }
        [data-ticker]:hover .ticker-track { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) { .ticker-track { animation: none !important; } }
      `}</style>
    </div>
  );
}
