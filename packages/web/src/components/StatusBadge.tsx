import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import type { ScanJobState } from "@openvuln/shared";
import { formatRelativeTime } from "../shared/lib/format";

export function StatusBadge({
  state,
  finishedAt,
}: {
  state: ScanJobState | null | undefined;
  finishedAt?: string | null;
}) {
  if (!state) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium text-ink-tertiary">
        No scan
      </span>
    );
  }

  if (state === "queued" || state === "dispatching") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium text-ink-secondary">
        <Clock size={12} /> Queued
      </span>
    );
  }

  if (state === "scanning") {
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

  if (state === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sev-high-bg px-2 py-0.5 text-xs font-medium text-danger">
        <XCircle size={12} /> Scan failed
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success-ink">
      <CheckCircle2 size={12} />
      {finishedAt ? `Scanned ${formatRelativeTime(finishedAt)}` : "Completed"}
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
