import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  Download,
  FileCode2,
  LoaderCircle,
  Lock,
  ShieldCheck,
} from "lucide-react";
import {
  api,
  apiUrl,
  type OwnerFindingSummary,
} from "../../shared/api/client";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ReportBody, type StructuredReport } from "../../components/ReportBody";
import { SeverityChip } from "../../components/SeverityChip";
import { ScanHistory } from "./ScanHistory";

/**
 * Owner 专属「Manage findings」：全部 findings（含未披露）+ 勾选披露 + 全量报告下载。
 * 仅在后端鉴权通过（父组件 owner 查询成功）时渲染。
 */
export function OwnerFindings({
  projectId,
  htmlUrl,
  findings,
}: {
  projectId: string;
  htmlUrl: string;
  findings: OwnerFindingSummary[];
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const disclosable = useMemo(
    () => findings.filter((f) => f.disclosure_state !== "disclosed"),
    [findings],
  );
  const allChecked = disclosable.length > 0 && disclosable.every((f) => selected.has(f.id));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(disclosable.map((f) => f.id)));
  };

  const discloseM = useMutation({
    mutationFn: (ids: string[]) => api.ownerDisclose(projectId, ids),
    onSuccess: (res) => {
      setConfirmOpen(false);
      setSelected(new Set());
      setFlash(
        `${res.disclosed_count} finding${res.disclosed_count === 1 ? "" : "s"} disclosed — now publicly visible with full report content.`,
      );
      void qc.invalidateQueries({ queryKey: ["owner-findings", projectId] });
      void qc.invalidateQueries({ queryKey: ["public", "project"] });
      void qc.invalidateQueries({ queryKey: ["public", "overview"] });
    },
  });

  return (
    <div className="space-y-4">
      {/* 工具行 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-base font-semibold text-ink">
            All findings ({findings.length})
          </h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2 py-0.5 text-[11px] font-medium text-accent-700">
            <Lock size={11} /> Owner only
          </span>
        </div>
        <a
          href={apiUrl(`/api/projects/${projectId}/report-full?format=md`)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface-raised px-3.5 text-sm font-medium text-ink transition-colors hover:bg-surface-sunken focus-ring"
          title="Download the complete report for all findings (markdown)"
        >
          <Download size={14} /> Full report (.md)
        </a>
      </div>

      {/* 版本扫描历史 + Rescan/Cancel（task-60217366） */}
      <ScanHistory projectId={projectId} htmlUrl={htmlUrl} />

      {/* 披露操作条 */}
      {disclosable.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-sunken/50 px-4 py-2.5">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-secondary">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-line accent-[#28D1FF]"
            />
            Select undisclosed ({disclosable.length})
          </label>
          <span className="text-[13px] text-ink-tertiary" aria-live="polite">
            {selected.size > 0 ? `${selected.size} selected` : ""}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-[12px] text-ink-tertiary sm:inline">
              Permanent · applies to the current scan version · full report goes public.
            </span>
            <Button
              size="md"
              disabled={selected.size === 0}
              onClick={() => setConfirmOpen(true)}
            >
              <ShieldCheck size={15} />
              Disclose{selected.size > 0 ? ` (${selected.size})` : ""}
            </Button>
          </div>
        </div>
      )}

      {flash && (
        <p
          className="flex items-start gap-1.5 rounded-lg border border-success/30 bg-success-bg px-4 py-2.5 text-[13px] text-success-ink"
          role="status"
        >
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          {flash}
        </p>
      )}

      {discloseM.isError && (
        <p className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-2.5 text-[13px] text-danger" role="alert">
          Disclosure failed. Please try again — if it persists, contact an operator.
        </p>
      )}

      {/* findings 卡片 */}
      {findings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm text-ink-secondary">
          No findings on the current scan.
        </div>
      ) : (
        <div className="space-y-3">
          {findings.map((f) => {
            const disclosed = f.disclosure_state === "disclosed";
            const open = openKey === f.finding_key;
            return (
              <article
                key={f.id}
                className="overflow-hidden rounded-xl border border-line bg-surface"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenKey(open ? null : f.finding_key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenKey(open ? null : f.finding_key);
                    }
                  }}
                  aria-expanded={open}
                  className="flex w-full cursor-pointer items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-sunken/50 focus-ring"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(f.id)}
                    disabled={disclosed}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggle(f.id)}
                    aria-label={disclosed ? `${f.finding_key} already disclosed` : `Select ${f.finding_key}`}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-line accent-[#28D1FF] disabled:opacity-40"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <SeverityChip severity={f.severity} />
                      {f.cwe && (
                        <span className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-secondary">
                          {f.cwe}
                        </span>
                      )}
                      {f.cvss_score != null && (
                        <span className="font-mono text-[11px] text-ink-tertiary">
                          CVSS {f.cvss_score.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <h3
                      className="mt-1.5 line-clamp-2 font-display text-[15px] font-semibold leading-snug text-ink"
                      title={f.title}
                    >
                      {f.title}
                    </h3>
                    <p className="mt-1 truncate font-mono text-[11px] text-ink-tertiary">
                      {f.finding_key}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2 self-center">
                    {disclosed ? (
                      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-success-ink">
                        <CheckCircle2 size={13} /> Disclosed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[12px] text-ink-tertiary">
                        <Lock size={12} /> Owner only
                      </span>
                    )}
                    <ChevronDown
                      size={16}
                      className={`text-ink-tertiary transition-transform ${open ? "rotate-180" : ""}`}
                    />
                  </span>
                </div>

                {open && <OwnerFindingDetailBody projectId={projectId} findingKey={f.finding_key} />}
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`Disclose ${selected.size} finding${selected.size === 1 ? "" : "s"}?`}
        body="The full report content of the selected findings — description, file paths, code and analysis — becomes publicly visible on OpenVuln. This cannot be undone from the site; an operator can reverse an accidental disclosure."
        confirmLabel="Disclose permanently"
        busy={discloseM.isPending}
        onConfirm={() => discloseM.mutate([...selected])}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

/** 展开后按需取单条全文（report + artifacts）。 */
function OwnerFindingDetailBody({
  projectId,
  findingKey,
}: {
  projectId: string;
  findingKey: string;
}) {
  const detailQ = useQuery({
    queryKey: ["owner-finding", projectId, findingKey],
    queryFn: () => api.ownerFinding(projectId, findingKey),
    staleTime: 60_000,
    retry: false,
  });

  if (detailQ.isPending) {
    return (
      <div className="flex items-center gap-2 border-t border-line px-5 py-6 text-[13px] text-ink-secondary">
        <LoaderCircle size={15} className="animate-spin" /> Loading full report…
      </div>
    );
  }
  if (detailQ.isError || !detailQ.data) {
    return (
      <div className="border-t border-line px-5 py-6 text-[13px] text-danger" role="alert">
        Failed to load the full report.
      </div>
    );
  }

  const f = detailQ.data.finding;
  const arts = (f.artifacts ?? []).filter((a) => a.has_content || a.size_bytes > 0);

  return (
    <div className="border-t border-line px-5 py-4">
      <ReportBody report={(f.report as StructuredReport | null) ?? undefined} yaml={f.report_yaml ?? undefined} />
      {arts.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">
            Artifacts ({arts.length})
          </h4>
          <ul className="mt-2 space-y-1">
            {arts.slice(0, 20).map((a) => (
              <li
                key={a.rel_path}
                className="flex items-center gap-2 font-mono text-[12px] text-ink-secondary"
                title={a.rel_path}
              >
                <FileCode2 size={13} className="shrink-0 text-ink-tertiary" />
                <span className="truncate">{a.file_name}</span>
                <span className="shrink-0 text-ink-tertiary">
                  {a.kind} · {formatSize(a.size_bytes)}
                </span>
              </li>
            ))}
            {arts.length > 20 && (
              <li className="text-[12px] text-ink-tertiary">…and {arts.length - 20} more</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
