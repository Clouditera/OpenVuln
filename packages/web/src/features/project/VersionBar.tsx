import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, ChevronDown, CircleCheck, LoaderCircle } from "lucide-react";
import { api, type ScanJobSummary } from "../../shared/api/client";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { formatRelativeTime, shortSha } from "../../shared/lib/format";

export interface ViewJob {
  id: string;
  label: string;
}

/**
 * 项目头部版本条（owner 专属，fish No.1253）：版本切换从 tab 内容区上移到标题区。
 * 紧凑单行：当前版本下拉（切换查看历史版本）+ 进行中状态（可取消）+ Rescan。
 */
export function VersionBar({
  projectId,
  viewJob,
  onViewJob,
}: {
  projectId: string;
  viewJob: ViewJob | null;
  onViewJob: (v: ViewJob | null) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ScanJobSummary | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const scansQ = useQuery({
    queryKey: ["project-scans", projectId],
    queryFn: () => api.projectScans(projectId),
    refetchInterval: (q) =>
      (q.state.data?.scans ?? []).some((s) => ["queued", "dispatching", "scanning"].includes(s.state))
        ? 5000
        : false,
    retry: false,
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ["project-scans", projectId] });
    void qc.invalidateQueries({ queryKey: ["public", "project"] });
    void qc.invalidateQueries({ queryKey: ["owner-findings", projectId] });
  };

  const cancelM = useMutation({
    mutationFn: (jobId: string) => api.cancelScanJob(projectId, jobId),
    onSettled: () => {
      setCancelTarget(null);
      invalidateAll();
    },
  });

  const scans = scansQ.data?.scans ?? [];
  const inflight = scans.find((s) => ["queued", "dispatching", "scanning"].includes(s.state));
  const completed = scans.filter((s) => s.state === "completed");
  const current = completed[0] ?? null; // 列表按创建时间倒序
  const viewing = viewJob ?? (current ? { id: current.id, label: current.commit_sha?.slice(0, 7) ?? "current" } : null);

  return (
    <div ref={rootRef} className="flex flex-wrap items-center gap-2 text-[13px]">
      {/* 版本切换下拉 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface-raised px-3 text-ink transition-colors hover:border-[#484a58] hover:bg-surface-sunken focus-ring"
        >
          <CircleCheck size={13} className="text-success" />
          <span className="font-mono text-[12px]">{viewing?.label ?? "—"}</span>
          <ChevronDown size={13} className={`text-ink-tertiary transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute left-0 top-full z-40 mt-1.5 w-72 overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
          >
            <ul className="max-h-72 overflow-y-auto py-1">
              {completed.map((s) => {
                const isCurrent = current?.id === s.id;
                const isSelected = viewing?.id === s.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpen(false);
                        onViewJob(isCurrent ? null : { id: s.id, label: s.commit_sha?.slice(0, 7) ?? s.id.slice(0, 8) });
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-sunken ${
                        isSelected ? "bg-surface-sunken" : ""
                      }`}
                    >
                      <span className="font-mono text-[12px] text-ink">
                        {s.commit_sha ? shortSha(s.commit_sha) : "—"}
                      </span>
                      <span className="text-[12px] text-ink-tertiary">{s.findings_so_far} findings</span>
                      <span className="ml-auto font-mono text-[11px] text-ink-tertiary">
                        {formatRelativeTime(s.created_at)}
                      </span>
                    </button>
                  </li>
                );
              })}
              {completed.length === 0 && (
                <li className="px-3 py-3 text-center text-[12px] text-ink-tertiary">No completed scans yet</li>
              )}
            </ul>
          </div>
        )}
      </div>

      {/* 进行中状态 + Cancel */}
      {inflight && (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-running/30 bg-running-bg px-3 text-running-ink">
          <LoaderCircle size={13} className="animate-spin" />
          <span className="text-[12px] font-medium capitalize">{inflight.state}</span>
          {inflight.state === "scanning" && (
            <span className="text-[12px]">{inflight.findings_so_far} so far</span>
          )}
          {(inflight.state === "queued" || inflight.state === "scanning") && (
            <button
              type="button"
              onClick={() => setCancelTarget(inflight)}
              className="ml-0.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] text-ink-secondary transition-colors hover:text-danger"
              title="Cancel this scan"
            >
              <Ban size={11} /> Cancel
            </button>
          )}
        </span>
      )}

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Cancel this scan?"
        body={`The ${cancelTarget?.state === "scanning" ? "running" : "queued"} scan will be stopped and its VulnHunter slot released. This version can be resubmitted later.`}
        confirmLabel="Cancel scan"
        danger
        busy={cancelM.isPending}
        onConfirm={() => cancelTarget && cancelM.mutate(cancelTarget.id)}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}
