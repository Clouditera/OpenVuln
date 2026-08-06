import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CircleCheck, CircleX, Clock3, LoaderCircle, RefreshCw } from "lucide-react";
import { api, type ScanJobSummary } from "../../shared/api/client";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { formatRelativeTime, shortSha } from "../../shared/lib/format";

/** owner 扫描历史（task-60217366 UI）：各版本状态 + Rescan latest + Cancel。 */
export function ScanHistory({
  projectId,
  htmlUrl,
  selectedId,
  onSelect,
}: {
  projectId: string;
  htmlUrl: string;
  /** 正在查看明细的版本（null=当前版本）。completed 行可点击切换。 */
  selectedId: string | null;
  onSelect: (job: ScanJobSummary | null) => void;
}) {
  const qc = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState<ScanJobSummary | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const scansQ = useQuery({
    queryKey: ["project-scans", projectId],
    queryFn: () => api.projectScans(projectId),
    refetchInterval: (q) => {
      const scans = q.state.data?.scans ?? [];
      return scans.some((s) => ["queued", "dispatching", "scanning"].includes(s.state))
        ? 5000
        : false;
    },
    retry: false,
  });

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ["project-scans", projectId] });
    void qc.invalidateQueries({ queryKey: ["public", "project"] });
    void qc.invalidateQueries({ queryKey: ["owner-findings", projectId] });
  };

  const rescanM = useMutation({
    mutationFn: () => api.submitProject({ git_url: htmlUrl }),
    onSuccess: () => {
      setFlash("Rescan requested — the latest default-branch commit is used. If it was already scanned, you'll see the existing results.");
      invalidateAll();
    },
  });

  const cancelM = useMutation({
    mutationFn: (jobId: string) => api.cancelScanJob(projectId, jobId),
    onSuccess: () => {
      setCancelTarget(null);
      setFlash("Scan cancelled. This version can be resubmitted anytime.");
      invalidateAll();
    },
    onError: () => setCancelTarget(null),
  });

  const scans = scansQ.data?.scans ?? [];
  const inflight = scans.filter((s) => ["queued", "dispatching", "scanning"].includes(s.state));
  const currentId = scans.find((s) => s.state === "completed")?.id ?? null;

  return (
    <section className="rounded-xl border border-line bg-surface-raised px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-sm font-semibold text-ink">
          Scan history ({scans.length})
        </h3>
        <Button
          variant="secondary"
          size="md"
          onClick={() => rescanM.mutate()}
          disabled={rescanM.isPending || inflight.length > 0}
          title={
            inflight.length > 0
              ? "A scan is already in progress for this project"
              : "Scan the latest default-branch commit"
          }
        >
          {rescanM.isPending ? (
            <LoaderCircle size={15} className="animate-spin" />
          ) : (
            <RefreshCw size={15} />
          )}
          Rescan latest
        </Button>
      </div>

      {flash && (
        <p className="mt-3 rounded-lg border border-success/30 bg-success-bg px-3 py-2 text-[13px] text-success-ink" role="status">
          {flash}
        </p>
      )}
      {rescanM.isError && (
        <p className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger" role="alert">
          Rescan failed — the latest commit may already be scanned, or a scan is in progress.
        </p>
      )}

      <ul className="mt-3 divide-y divide-line">
        {scans.map((s) => {
          const cancellable = s.state === "queued" || s.state === "scanning";
          const viewable = s.state === "completed";
          const isSelected = (selectedId ?? currentId) === s.id;
          return (
            <li
              key={s.id}
              onClick={viewable ? () => onSelect(s.id === currentId ? null : s) : undefined}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-2 text-[13px] transition-colors ${
                viewable ? "cursor-pointer hover:bg-surface-sunken" : ""
              } ${isSelected ? "bg-surface-sunken" : ""}`}
              title={viewable ? "View findings of this version" : undefined}
            >
              <ScanStateChip state={s.state} />
              <span className="font-mono text-[12px] text-ink">
                {s.commit_sha ? shortSha(s.commit_sha) : "—"}
              </span>
              {s.id === currentId && (
                <span className="rounded-full bg-accent-50 px-1.5 py-px text-[10px] font-medium text-accent-600">
                  current
                </span>
              )}
              {s.git_ref && (
                <span className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-secondary">
                  {s.git_ref}
                </span>
              )}
              <span className="text-ink-tertiary">
                {s.state === "completed"
                  ? `${s.findings_so_far} findings`
                  : s.state === "scanning"
                    ? `${s.findings_so_far} so far`
                    : ""}
              </span>
              <span className="ml-auto font-mono text-[11px] text-ink-tertiary">
                {formatRelativeTime(s.created_at)}
              </span>
              {cancellable && (
                <button
                  type="button"
                  onClick={() => setCancelTarget(s)}
                  className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px] text-ink-secondary transition-colors hover:border-danger/40 hover:text-danger focus-ring"
                >
                  <Ban size={12} />
                  Cancel
                </button>
              )}
            </li>
          );
        })}
        {scansQ.isSuccess && scans.length === 0 && (
          <li className="py-4 text-center text-[13px] text-ink-tertiary">No scans yet.</li>
        )}
      </ul>

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Cancel this scan?"
        body={`The ${cancelTarget?.state === "scanning" ? "running" : "queued"} scan (${cancelTarget?.commit_sha ? shortSha(cancelTarget.commit_sha) : "this version"}) will be stopped and its VulnHunter slot released. This version can be resubmitted later.`}
        confirmLabel="Cancel scan"
        danger
        busy={cancelM.isPending}
        onConfirm={() => cancelTarget && cancelM.mutate(cancelTarget.id)}
        onCancel={() => setCancelTarget(null)}
      />
    </section>
  );
}

function ScanStateChip({ state }: { state: ScanJobSummary["state"] }) {
  const map = {
    completed: { icon: CircleCheck, cls: "text-success-ink", label: "Completed" },
    scanning: { icon: LoaderCircle, cls: "text-running-ink", label: "Scanning" },
    queued: { icon: Clock3, cls: "text-ink-secondary", label: "Queued" },
    dispatching: { icon: Clock3, cls: "text-ink-secondary", label: "Dispatching" },
    failed: { icon: CircleX, cls: "text-danger", label: "Failed" },
    cancelled: { icon: Ban, cls: "text-ink-tertiary", label: "Cancelled" },
  } as const;
  const { icon: Icon, cls, label } = map[state] ?? map.queued;
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] font-medium ${cls}`}>
      <Icon size={13} className={state === "scanning" ? "animate-spin" : ""} />
      {label}
    </span>
  );
}
