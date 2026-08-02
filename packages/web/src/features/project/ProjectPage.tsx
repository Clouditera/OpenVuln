import { useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, ChevronDown, ExternalLink, Download } from "lucide-react";
import { api } from "../../shared/api/client";
import {
  formatDate,
  formatStars,
  shortSha,
  totalFindings,
} from "../../shared/lib/format";
import { SeverityBar } from "../../components/SeverityBar";
import { SeverityChip } from "../../components/SeverityChip";
import { ReportBody } from "../../components/ReportBody";
import { StatusBadge, ScanningSpinner } from "../../components/StatusBadge";
import { EmptyState } from "../../components/EmptyState";
import { Shield } from "lucide-react";

export function ProjectPage() {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const { owner = "", repo = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "details" ? "details" : "overview";
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
      if (s === "queued" || s === "dispatching" || s === "scanning") return 5000;
      return false;
    },
  });

  const project = projectQ.data;
  const cweMax = useMemo(() => {
    const list = project?.cwe_distribution ?? [];
    return Math.max(1, ...list.map((c) => c.count));
  }, [project]);

  if (projectQ.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-16">
        <ScanningSpinner label="Loading project…" />
      </div>
    );
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
          Added to the scan queue.
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
      </div>

      {/* Tabs */}
      <div className="mt-4 flex gap-1 border-b border-line">
        <TabButton active={tab === "overview"} onClick={() => setParams({})}>
          Overview
        </TabButton>
        <TabButton active={tab === "details"} onClick={() => setParams({ tab: "details" })}>
          Details
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
            <p className="mt-8 text-sm text-ink-secondary">This project is in the scan queue.</p>
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
                  Detailed findings are reviewed by the OpenVuln operations team and shared privately
                  with project maintainers. Public disclosure happens after maintainer confirmation.
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
                        href={`/api/projects/${project.id}/report?format=zip`}
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
                                href={`/api/projects/${project.id}/report/${encodeURIComponent(f.finding_key)}`}
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

      {tab === "details" && (
        <div className="space-y-4 py-6">
          {project.disclosed_findings.length === 0 ? (
            <div className="rounded-md border border-line bg-surface-raised p-6">
              <h2 className="font-display text-base font-semibold text-ink">
                No disclosures yet
              </h2>
              <p className="mt-2 w-full text-sm leading-relaxed text-ink-secondary">
                Full finding details stay encrypted until an operator discloses them. Confirmed
                disclosures appear here with the original report content, and on the Overview tab.
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
                  <button
                    type="button"
                    onClick={() => setOpenKey(open ? null : f.id)}
                    aria-expanded={open}
                    className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-sunken/50 focus-ring sm:px-6"
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
                        className="line-clamp-2 font-display text-base font-semibold leading-snug text-ink"
                        title={f.title}
                      >
                        {f.title}
                      </h3>
                      <p className="font-mono text-[11px] text-ink-tertiary">{f.finding_key}</p>
                    </div>
                    <span className="flex shrink-0 items-center gap-2 self-center">
                      <a
                        href={`/api/projects/${project.id}/report/${encodeURIComponent(f.finding_key)}`}
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
                  </button>
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
