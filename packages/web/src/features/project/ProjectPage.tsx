import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  ArrowUpRight,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Github,
  LoaderCircle,
  Shield,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EmptyState } from "../../components/EmptyState";
import { ReportBody } from "../../components/ReportBody";
import { ScanDurationNotice } from "../../components/ScanDurationNotice";
import { SeverityBar } from "../../components/SeverityBar";
import { SeverityChip } from "../../components/SeverityChip";
import { ScanningSpinner, StatusBadge } from "../../components/StatusBadge";
import { api, apiUrl } from "../../shared/api/client";
import { useMe } from "../auth/useAuth";
import { OwnerFindings } from "./OwnerFindings";
import { VersionBar, type ViewJob } from "./VersionBar";
import { formatDate, formatStars, shortSha, totalFindings } from "../../shared/lib/format";

export function ProjectPage() {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const { owner = "", repo = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const location = useLocation();
  const justSubmitted = Boolean(
    (location.state as { justSubmitted?: boolean } | null)?.justSubmitted,
  );

  const projectQ = useQuery({
    queryKey: ["public", "project", owner, repo],
    queryFn: () => api.getProject(owner, repo),
    enabled: Boolean(owner && repo),
    refetchInterval: (q) => {
      const s = q.state.data?.latest_scan?.state;
      if (s === "pending_review" || s === "queued" || s === "dispatching" || s === "scanning") return 5000;
      return false;
    },
  });

  const project = projectQ.data;
  const meQ = useMe();
  // owner 探测：登录后尝试拉取全量 findings；200=有权限（显示 Manage findings tab），401/403=公众视图
  const ownerQ = useQuery({
    queryKey: ["owner-findings", project?.id],
    queryFn: () => api.ownerFindings(project!.id),
    enabled: Boolean(project?.id) && meQ.data?.authenticated === true,
    retry: false,
    staleTime: 30_000,
  });
  const isOwner = ownerQ.isSuccess;
  // 版本查看状态（fish No.1253：切换操作上移到头部）
  const [viewJob, setViewJob] = useState<ViewJob | null>(null);
  // Details 与 Manage findings 合并为 Findings（fish No.1252）；tab=details 兼容旧链接
  const tab = tabParam === "findings" || tabParam === "details" ? "findings" : "overview";
  const cweMax = useMemo(() => {
    const list = project?.cwe_distribution ?? [];
    return Math.max(1, ...list.map((c) => c.count));
  }, [project]);

  if (projectQ.isLoading) {
    return <ScanProgressPage owner={owner} repo={repo} state="loading" />;
  }

  if (projectQ.isError || !project) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-16">
        <EmptyState
          icon={Shield}
          title="Project not found"
          description="This project is not on OpenVuln yet."
          action={
            <Link to="/#projects" className="text-sm text-accent-600 hover:underline">
              Back to projects
            </Link>
          }
        />
      </div>
    );
  }

  const state = project.latest_scan?.state;
  const scanning = state === "scanning" || state === "dispatching";
  const soFar = project.latest_scan?.findings_so_far ?? 0;
  const findingsTotal = totalFindings(project.severity_counts);

  if (state === "pending_review" || state === "queued" || scanning) {
    return (
      <ScanProgressPage
        owner={project.owner_login}
        repo={project.name}
        htmlUrl={project.html_url}
        branch={project.default_branch}
        state={state}
        findingsSoFar={soFar}
        justSubmitted={justSubmitted}
        projectId={project.id}
        jobId={project.latest_scan?.id}
        canCancel={isOwner && (state === "pending_review" || state === "queued" || state === "scanning")}
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link
        to="/#projects"
        className="inline-flex items-center gap-1.5 text-[13px] text-ink-secondary hover:text-ink"
      >
        <ArrowLeft size={14} /> Projects
      </Link>

      {justSubmitted && (
        <div
          className="mt-4 rounded-md border border-accent-100 bg-accent-50 px-4 py-3 text-sm text-accent-700"
          role="status"
        >
          Submitted for review.
        </div>
      )}

      {/* Header */}
      <div className="mt-4 border-b border-line pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-xl font-semibold tracking-tight">
            <span className="text-ink-secondary">{project.owner_login}</span>
            <span className="text-ink-tertiary"> / </span>
            <span className="text-ink">{project.name}</span>
          </h1>
          <a
            href={project.html_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center text-ink-secondary hover:text-accent-600"
            title="View on GitHub"
          >
            <ExternalLink size={14} />
          </a>
        </div>
        {project.description && (
          <p className="mt-2 max-w-prose text-sm text-ink-secondary">{project.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-tertiary">
          {project.language && (
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-600/70" />
              {project.language}
            </span>
          )}
          <span>·</span>
          <span>★ {formatStars(project.stars)}</span>
          <span>·</span>
          <span>Added {formatDate(project.created_at)}</span>
        </div>
        {isOwner && (
          <div className="mt-3">
            <VersionBar projectId={project.id} viewJob={viewJob} onViewJob={setViewJob} />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="mt-4 flex gap-1 border-b border-line">
        <TabButton active={tab === "overview"} onClick={() => setParams({})}>
          Overview
        </TabButton>
        <TabButton active={tab === "findings"} onClick={() => setParams({ tab: "findings" })}>
          Findings
        </TabButton>
      </div>

      {tab === "overview" && (
        <div className="py-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <StatusBadge state={state} finishedAt={project.latest_scan?.finished_at} />
            {project.latest_scan?.finished_at && (
              <span className="text-ink-secondary">
                {formatDate(project.latest_scan.finished_at)}
              </span>
            )}
            {project.latest_scan?.commit_sha && (
              <a
                href={`${project.html_url}/commit/${project.latest_scan.commit_sha}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 font-mono text-[13px] text-ink-secondary hover:text-accent-600"
              >
                {shortSha(project.latest_scan.commit_sha)}
                <ArrowUpRight size={12} />
              </a>
            )}
          </div>
          <p className="mt-2 text-[13px] text-ink-secondary">
            {state === "completed" ? "Scanned" : scanning ? "Scanning" : "To be scanned"} by{" "}
            <span className="font-medium text-ink">VulnHunter AI engine</span>
            {project.default_branch ? ` · default branch (${project.default_branch})` : null}
          </p>

          {scanning && (
            <div className="mt-8 space-y-3">
              <ScanningSpinner
                label={
                  soFar > 0
                    ? `Scan in progress — ${soFar} finding${soFar === 1 ? "" : "s"} so far`
                    : "Scan in progress — stats will appear when complete."
                }
              />
              <div className="h-2 w-full max-w-xl animate-pulse rounded-full bg-surface-sunken" />
            </div>
          )}

          {state !== "completed" && !scanning && (
            <p className="mt-8 text-sm text-ink-secondary">This project is in review.</p>
          )}

          {state === "completed" && (
            <>
              <section className="mt-8">
                <p className="font-mono text-[11px] uppercase tracking-wider text-ink-tertiary">
                  Scan results
                </p>
                <h2 className="mt-1 font-display text-base font-semibold text-ink">
                  Findings overview
                </h2>
                {findingsTotal === 0 ? (
                  <p className="mt-3 max-w-prose text-sm text-ink-secondary">
                    No findings were confirmed in this scan. A clean scan does not prove a project is
                    free of vulnerabilities.
                  </p>
                ) : (
                  <>
                    <p className="mt-3 text-sm font-medium text-ink">
                      {findingsTotal} finding{findingsTotal === 1 ? "" : "s"} found
                    </p>
                    <div className="mt-4">
                      <SeverityBar
                        counts={project.severity_counts}
                        widthClass="w-full max-w-[80%]"
                        heightClass="h-2"
                      />
                    </div>
                  </>
                )}
              </section>

              {project.cwe_distribution.length > 0 && (
                <section className="mt-10">
                  <h2 className="font-display text-base font-semibold text-ink">
                    Top CWE categories
                  </h2>
                  <ul className="mt-4 max-w-[80%] space-y-2.5">
                    {project.cwe_distribution.slice(0, 5).map((c) => (
                      <li key={c.cwe} className="flex items-center gap-3 text-sm">
                        <a
                          href={`https://cwe.mitre.org/data/definitions/${c.cwe.replace(/^CWE-/i, "")}.html`}
                          target="_blank"
                          rel="noreferrer"
                          className="w-24 shrink-0 font-mono text-[13px] text-accent-700 hover:underline"
                        >
                          {c.cwe}
                        </a>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                          <div
                            className="h-full rounded-full bg-ink/40"
                            style={{ width: `${(c.count / cweMax) * 100}%` }}
                          />
                        </div>
                        <span className="w-8 text-right font-mono text-[13px] text-ink-secondary">
                          {c.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <div className="mt-10 rounded-md border border-line bg-surface-raised p-5">
                <p className="text-sm leading-relaxed text-ink-secondary">
                  Detailed findings are visible to signed-in repository maintainers. Maintainers
                  review the full reports and choose what to disclose publicly.
                </p>
              </div>

              {project.disclosed_findings.length > 0 && (
                <section className="mt-10">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-display text-base font-semibold text-ink">
                      Disclosed findings
                    </h2>
                    <div className="flex items-center gap-3 text-[13px]">
                      <a
                        href={apiUrl(`/api/projects/${project.id}/report?format=zip`)}
                        className="inline-flex items-center gap-1 text-ink-secondary hover:text-accent-600"
                      >
                        <Download size={14} /> Download all (zip)
                      </a>
                    </div>
                  </div>
                  <div className="mt-3 overflow-hidden rounded-md border border-line">
                    <table className="w-full table-fixed text-left text-sm">
                      <thead className="border-b border-line bg-surface-sunken/50 text-xs uppercase tracking-wide text-ink-secondary">
                        <tr>
                          <th className="w-[92px] px-3 py-2.5 font-medium">Sev</th>
                          <th className="px-3 py-2.5 font-medium">Title</th>
                          <th className="w-[112px] px-3 py-2.5 font-medium">CWE</th>
                          <th className="w-[120px] px-3 py-2.5 font-medium">Status</th>
                          <th className="w-[52px] px-3 py-2.5 font-medium" />
                        </tr>
                      </thead>
                      <tbody>
                        {project.disclosed_findings.map((f) => (
                          <tr key={f.id} className="border-b border-line last:border-0">
                            <td className="px-3 py-3">
                              <SeverityChip severity={f.severity} />
                            </td>
                            <td className="max-w-0 truncate px-3 py-3 font-medium text-ink" title={f.title}>
                              {f.title}
                            </td>
                            <td className="px-3 py-3 font-mono text-[13px] text-ink-secondary">
                              {f.cwe ?? "—"}
                            </td>
                            <td className="px-3 py-3 text-[13px] text-success">Disclosed</td>
                            <td className="px-3 py-3 text-right">
                              <a
                                href={apiUrl(`/api/projects/${project.id}/report/${encodeURIComponent(f.finding_key)}`)}
                                className="text-ink-tertiary hover:text-accent-600"
                                title="Download full report (markdown)"
                                download
                              >
                                <Download size={14} className="inline" />
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {tab === "findings" && !isOwner && (
        <div className="space-y-4 py-6">
          {project.disclosed_findings.length === 0 ? (
            <div className="rounded-md border border-line bg-surface-raised p-6">
              <h2 className="font-display text-base font-semibold text-ink">
                No disclosures yet
              </h2>
              <p className="mt-2 w-full text-sm leading-relaxed text-ink-secondary">
                Full finding details are visible to repository maintainers after sign-in. Disclosed
                findings appear here with the full report content, and on the Overview tab.
              </p>
            </div>
          ) : (
            project.disclosed_findings.map((f) => {
              const open = openKey === f.id;
              return (
                <article
                  key={f.id}
                  className="overflow-hidden rounded-md border border-line bg-surface-raised"
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpenKey(open ? null : f.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpenKey(open ? null : f.id);
                      }
                    }}
                    aria-expanded={open}
                    className="flex w-full cursor-pointer items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-sunken/50 focus-ring sm:px-6"
                  >
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityChip severity={f.severity} />
                        {f.cwe && (
                          <span className="font-mono text-[12px] text-ink-secondary">{f.cwe}</span>
                        )}
                        <span className="text-[12px] text-success">Disclosed</span>
                      </div>
                      <h3
                        className="line-clamp-2 font-display text-[15px] font-semibold leading-snug text-ink"
                        title={f.title}
                      >
                        {f.title}
                      </h3>
                      <p className="font-mono text-[11px] text-ink-tertiary">{f.finding_key}</p>
                    </div>
                    <span className="flex shrink-0 items-center gap-2 self-center">
                      <a
                        href={apiUrl(`/api/projects/${project.id}/report/${encodeURIComponent(f.finding_key)}`)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink-secondary hover:border-accent-300 hover:text-accent-700"
                        download
                        onClick={(e) => e.stopPropagation()}
                        title="Download full report (markdown)"
                      >
                        <Download size={14} />
                        .md
                      </a>
                      <ChevronDown
                        size={16}
                        className={`text-ink-tertiary transition-transform ${open ? "rotate-180" : ""}`}
                      />
                    </span>
                  </div>
                  {open && (
                    <div className="border-t border-line px-5 pb-5 sm:px-6 sm:pb-6">
                      {f.report ? (
                        <ReportBody report={f.report} />
                      ) : (
                        <p className="mt-4 text-sm text-ink-tertiary">
                          Structured report is not available for this disclosure (older
                          summary-only disclose). Use the download button if a fidelity pack was
                          attached later.
                        </p>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      )}

      {tab === "findings" && isOwner && (
        <div className="py-6">
          <OwnerFindings
            projectId={project.id}
            currentFindings={ownerQ.data?.findings ?? []}
            viewJob={viewJob}
            onViewJob={setViewJob}
          />
        </div>
      )}
    </div>
  );
}

function ScanProgressPage({
  owner,
  repo,
  htmlUrl,
  branch,
  state,
  findingsSoFar = 0,
  justSubmitted = false,
  projectId,
  jobId,
  canCancel = false,
}: {
  owner: string;
  repo: string;
  htmlUrl?: string;
  branch?: string | null;
  state: "loading" | "pending_review" | "queued" | "dispatching" | "scanning";
  findingsSoFar?: number;
  justSubmitted?: boolean;
  /** owner 取消入口（fish No.1454：进度页此前没有 Cancel） */
  projectId?: string;
  jobId?: string;
  canCancel?: boolean;
}) {
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const navigate = useNavigate();
  const cancelM = useMutation({
    mutationFn: () => api.cancelScanJob(projectId!, jobId!),
    onSuccess: (res) => {
      setCancelOpen(false);
      if (res.deleted === "project") {
        void qc.invalidateQueries({ queryKey: ["my-projects"] });
        navigate("/my", { replace: true });
        return;
      }
      void qc.invalidateQueries({ queryKey: ["public", "project"] });
      void qc.invalidateQueries({ queryKey: ["owner-scans", projectId] });
    },
  });
  useEffect(() => {
    document.body.classList.add("openvuln-running");
    return () => document.body.classList.remove("openvuln-running");
  }, []);

  const inReview = state === "pending_review" || state === "queued";
  const loading = state === "loading";
  const dispatching = state === "dispatching";
  const currentStage = inReview ? 0 : dispatching ? 1 : 2;
  const stages = ["In review", "Preparing", "Scanning", "Results"];
  const statusLabel = loading
    ? "Loading scan status"
    : inReview
      ? "Submission in review"
      : dispatching
        ? "Preparing the scan"
        : "AI security analysis in progress";
  const detail = loading
    ? "Retrieving the latest status…"
    : inReview
      ? "The OpenVuln team reviews new submissions before scanning. You'll receive an email with the result — approved projects start scanning automatically."
      : dispatching
        ? "OpenVuln is packaging the repository and handing it to an available scanner."
        : findingsSoFar > 0
          ? `${findingsSoFar} confirmed finding${findingsSoFar === 1 ? "" : "s"} so far. Analysis is still running.`
          : "VulnHunter is analyzing the repository. Results will appear after the scan completes.";

  return (
    <div className="openvuln-home fixed inset-0 z-50 overflow-y-auto bg-black text-white">
      <div className="openvuln-glow pointer-events-none absolute inset-0 -z-10" />

      <header className="flex items-center justify-between px-5 py-5 sm:px-8 sm:py-7">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-full border border-[#333] bg-[#030303] px-3.5 py-2 text-xs font-medium text-[#acacb0] transition hover:border-[#484a58] hover:bg-[#111216] hover:text-white focus-ring-dark"
        >
          <ArrowLeft size={14} />
          OpenVuln
        </Link>
        {htmlUrl && (
          <a
            href={htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-[#333] bg-[#030303] px-3.5 py-2 text-xs font-medium text-[#acacb0] transition hover:border-[#484a58] hover:bg-[#111216] hover:text-white focus-ring-dark"
          >
            <Github size={14} />
            GitHub
          </a>
        )}
      </header>

      <main className="mx-auto flex min-h-[calc(100vh-88px)] w-full max-w-4xl flex-col items-center justify-center px-5 pb-16 pt-8 text-center sm:px-8">
        <div className="openvuln-brand flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-[#151619] shadow-[0_18px_64px_rgba(0,0,0,0.5)]">
          <LoaderCircle
            size={28}
            className="animate-spin text-[#c9ccd6] motion-reduce:animate-none"
            strokeWidth={1.7}
          />
        </div>

        <p className="mt-7 font-mono text-[11px] uppercase tracking-[0.22em] text-[#85868d]">
          {justSubmitted ? "Submitted for review" : "Live scan status"}
        </p>
        <h1 className="openvuln-title mt-3 text-balance text-3xl font-medium leading-tight sm:text-5xl">
          {statusLabel}
        </h1>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm leading-none text-[#acacb0]">
          <span className="leading-none text-[#f0f2f6]">{owner}</span>
          <span className="leading-none text-[#5f6067]">/</span>
          <span className="leading-none text-[#f0f2f6]">{repo}</span>
          {branch && (
            <>
              <span className="leading-none text-[#5f6067]">·</span>
              <span className="font-mono text-[13px] leading-none text-[#85868d]">{branch}</span>
            </>
          )}
        </div>

        <div className="openvuln-composer mt-9 w-full max-w-2xl rounded-[22px] border border-[#333] bg-[#111216] px-5 py-5 text-left shadow-[0_24px_90px_rgba(0,0,0,0.52)] sm:px-6">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#aeb0ba] opacity-50 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#d5d7df]" />
            </span>
            <p className="text-sm font-medium text-[#f0f2f6]">{statusLabel}</p>
          </div>
          <p className="mt-3 text-sm leading-6 text-[#85868d]">{detail}</p>
          {!loading && (
            <div className="mt-5 border-t border-[#27282e] pt-4">
              <div className="flex items-center justify-between text-xs text-[#66676e]">
                <span>Current stage</span>
                <span>
                  {currentStage + 1} of {stages.length}
                </span>
              </div>
              <ol className="mt-3 grid grid-cols-4 gap-2" aria-label="Scan stages">
                {stages.map((stageLabel, index) => {
                  const complete = index < currentStage;
                  const current = index === currentStage;
                  return (
                    <li
                      key={stageLabel}
                      className={`flex min-w-0 flex-col items-center gap-2 rounded-xl border px-2 py-3 text-center ${
                        current
                          ? "border-[#4b4d58] bg-[#1a1b20] text-[#f0f2f6]"
                          : complete
                            ? "border-[#303139] bg-[#151619] text-[#acacb0]"
                            : "border-[#24252a] bg-[#121317] text-[#5f6067]"
                      }`}
                      aria-current={current ? "step" : undefined}
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] ${
                          current
                            ? "border-[#b7bac5] bg-[#d5d7df] text-[#111216]"
                            : complete
                              ? "border-[#555762] bg-[#26272d] text-[#d5d7df]"
                              : "border-[#303139] text-[#5f6067]"
                        }`}
                      >
                        {complete ? <Check size={13} strokeWidth={2.2} /> : index + 1}
                      </span>
                      <span className="truncate text-[11px] font-medium sm:text-xs">
                        {stageLabel}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3 text-xs text-[#66676e]">
                This shows status stages, not elapsed-time progress. Refreshes every 5 seconds.
              </p>
            </div>
          )}
        </div>

        {canCancel && projectId && jobId && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#333] bg-transparent px-3.5 text-xs font-medium text-[#acacb0] transition hover:border-[#a94d55] hover:text-[#ff9ca5] focus-ring-dark"
            >
              <Ban size={13} />
              Cancel this scan
            </button>
          </div>
        )}
        <ScanDurationNotice className="mt-4 w-full max-w-2xl" />

        <ConfirmDialog
          open={cancelOpen}
          title="Remove this submission?"
          body="This submission will be removed. You can submit the same repository again later."
          confirmLabel="Remove submission"
          danger
          busy={cancelM.isPending}
          onConfirm={() => cancelM.mutate()}
          onCancel={() => setCancelOpen(false)}
        />
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px inline-flex items-center border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-ring ${
        active
          ? "border-accent-600 text-accent-700"
          : "border-transparent text-ink-secondary hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
