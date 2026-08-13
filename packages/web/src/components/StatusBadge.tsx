import { CheckCircle2, Clock, Loader2 } from "lucide-react";
import type { ScanJobState } from "@openvuln/shared";
import { formatRelativeTime } from "../shared/lib/format";

export function StatusBadge({
  state,
  finishedAt,
}: {
  state: ScanJobState | null | undefined;
  finishedAt?: string | null;
}) {
  if (state === "completed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success-ink">
        <CheckCircle2 size={12} />
        {finishedAt ? `Scanned ${formatRelativeTime(finishedAt)}` : "Completed"}
      </span>
    );
  }
  if (state === "scanning" || state === "dispatching") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-running-bg px-2 py-0.5 text-xs font-medium text-running-ink">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-running opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-running" />
        </span>
        Scanning
      </span>
    );
  }
  // pending_review / queued / failed / null → 审核中（fish No.1341：待审与队列统一显示审核中，失败不外露）
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium text-ink-secondary">
      <Clock size={12} /> In review
    </span>
  );
}

export function ScanningSpinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink-secondary" role="status">
      <Loader2 size={16} className="animate-spin text-accent-600" />
      {label}
    </div>
  );
}
