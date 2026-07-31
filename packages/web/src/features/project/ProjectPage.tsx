import { useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ArrowLeft,
  Download,
  ExternalLink,
  Lock,
  Sparkles,
} from "lucide-react";
import type { FindingListItem, MeResponse } from "@openvuln/shared";
import { api, githubLoginUrl } from "../../shared/api/client";
import {
  formatDate,
  formatStars,
  shortSha,
  totalFindings,
} from "../../shared/lib/format";
import { Button } from "../../components/Button";
import { SeverityBar } from "../../components/SeverityBar";
import { SeverityChip } from "../../components/SeverityChip";
import { StatusBadge, ScanningSpinner } from "../../components/StatusBadge";
import { EmptyState } from "../../components/EmptyState";
import { ConfirmDialog } from "../../components/ConfirmDialog";

function hasGrant(me: MeResponse | undefined, projectId: string): boolean {
  if (!me?.authenticated || !me.user) return false;
  if (me.user.is_admin) return true;
  return me.grants.some((g) => g.project_id === projectId);
}

export function ProjectPage() {
  const { owner = "", repo = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "findings" ? "findings" : "overview";
  const location = useLocation();
  const justSubmitted = Boolean((location.state as { justSubmitted?: boolean } | null)?.justSubmitted);

  const qc = useQueryClient();
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

  const meQ = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 30_000 });
  const project = projectQ.data;
  const isOwner = hasGrant(meQ.data, project?.id ?? "");

  const findingsQ = useQuery({
    queryKey: ["owner", "findings", project?.id],
    queryFn: () => api.listFindings(project!.id),
    enabled: Boolean(project?.id && isOwner && tab === "findings"),
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const discloseM = useMutation({
    mutationFn: () =>
      api.disclose(project!.id, { finding_ids: Array.from(selected) }),
    onSuccess: async () => {
      setSelected(new Set());
      setConfirmOpen(false);
      await qc.invalidateQueries({ queryKey: ["owner", "findings", project?.id] });
      await qc.invalidateQueries({ queryKey: ["public", "project", owner, repo] });
    },
  });

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
          icon={Lock}
          title="Project not found"
          description="This project is not on OpenVuln yet."
          action={
            <Link to="/submit">
              <Button>Submit a project</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const state = project.latest_scan?.state;
  const scanning = state === "queued" || state === "dispatching" || state === "scanning";
  const findingsTotal = totalFindings(project.severity_counts);
  const fullName = `${owner}/${repo}`;

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
      <div className="mt-4 flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
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
        {isOwner && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success-bg px-3 py-1.5 text-xs font-medium text-success-ink">
            Verified maintainer
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="mt-4 flex gap-1 border-b border-line">
        <TabButton
          active={tab === "overview"}
          onClick={() => setParams({})}
        >
          Overview
        </TabButton>
        <TabButton
          active={tab === "findings"}
          onClick={() => setParams({ tab: "findings" })}
        >
          Details
          {!isOwner && <Lock size={12} className="ml-1 inline opacity-70" />}
          {isOwner && findingsQ.data ? (
            <span className="ml-1 font-mono text-ink-tertiary">
              ({findingsQ.data.items.length})
            </span>
          ) : null}
        </TabButton>
      </div>

      {tab === "overview" && (
        <div className="py-6">
          {/* Scan band */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <StatusBadge state={state} finishedAt={project.latest_scan?.finished_at} />
            {project.latest_scan?.finished_at && (
              <span className="text-ink-secondary">{formatDate(project.latest_scan.finished_at)}</span>
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
            Scanned by{" "}
            <span className="font-medium text-ink">VulnHunter AI engine</span>
            {project.default_branch ? ` · default branch (${project.default_branch})` : null}
          </p>

          {scanning && (
            <div className="mt-8 space-y-3">
              <ScanningSpinner label="Scan in progress — stats will appear when complete." />
              <div className="h-2 w-full animate-pulse rounded-full bg-surface-sunken" />
            </div>
          )}

          {state === "failed" && (
            <p className="mt-6 text-sm text-danger">
              The latest scan did not complete. Our team has been notified.
            </p>
          )}

          {state === "completed" && (
            <>
              <section className="mt-8">
                <h2 className="font-display text-base font-semibold text-ink">Findings overview</h2>
                {findingsTotal === 0 ? (
                  <p className="mt-3 max-w-prose text-sm text-ink-secondary">
                    No findings were confirmed in this scan. A clean scan does not prove a project is
                    free of vulnerabilities.
                  </p>
                ) : (
                  <>
                    <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink">
                      <span className="font-medium">
                        {findingsTotal} confirmed finding{findingsTotal === 1 ? "" : "s"}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-ai/30 bg-ai-bg px-2 py-0.5 text-xs font-medium text-ai-ink">
                        <Sparkles size={12} /> AI-discovered
                      </span>
                    </p>
                    <div className="mt-4">
                      <SeverityBar
                        counts={project.severity_counts}
                        widthClass="w-full"
                        heightClass="h-2"
                      />
                    </div>
                  </>
                )}
              </section>

              {project.cwe_distribution.length > 0 && (
                <section className="mt-10">
                  <h2 className="font-display text-base font-semibold text-ink">Top CWE categories</h2>
                  <ul className="mt-4 w-full space-y-2.5">
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

              {/* Lock card */}
              {!isOwner && (
                <div className="mt-10 flex flex-col gap-3 rounded-md border border-line bg-surface-raised p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <div className="flex gap-3">
                    <Lock size={18} className="mt-0.5 shrink-0 text-ink-tertiary" />
                    <p className="max-w-prose text-sm text-ink-secondary">
                      Detailed findings, including file paths and code snippets, are visible to
                      verified project maintainers only.
                    </p>
                  </div>
                  <a href={githubLoginUrl(fullName)} className="shrink-0">
                    <Button variant="secondary">Verify as owner</Button>
                  </a>
                </div>
              )}

              {/* Disclosed */}
              {project.disclosed_findings.length > 0 && (
                <section className="mt-10">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-display text-base font-semibold text-ink">
                      Disclosed findings
                    </h2>
                    <a
                      href={`/api/projects/${project.id}/report?format=zip`}
                      className="inline-flex items-center gap-1.5 text-[13px] text-ink-secondary hover:text-accent-600"
                      download
                    >
                      <Download size={14} className="text-ink-tertiary" />
                      Download all (zip)
                    </a>
                  </div>
                  <div className="mt-3 overflow-hidden rounded-md border border-line">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-line bg-surface-sunken/50 text-xs uppercase tracking-wide text-ink-secondary">
                        <tr>
                          <th className="px-3 py-2.5 font-medium">Sev</th>
                          <th className="px-3 py-2.5 font-medium">Title</th>
                          <th className="px-3 py-2.5 font-medium">CWE</th>
                          <th className="px-3 py-2.5 font-medium">Status</th>
                          <th className="w-10 px-3 py-2.5" aria-label="Download" />
                        </tr>
                      </thead>
                      <tbody>
                        {project.disclosed_findings.map((f) => (
                          <tr key={f.id} className="border-b border-line last:border-0">
                            <td className="px-3 py-3">
                              <SeverityChip severity={f.severity} />
                            </td>
                            <td className="px-3 py-3 font-medium text-ink">{f.title}</td>
                            <td className="px-3 py-3 font-mono text-[13px] text-ink-secondary">
                              {f.cwe ?? "—"}
                            </td>
                            <td className="px-3 py-3 text-[13px] text-success-ink">Disclosed</td>
                            <td className="px-3 py-3">
                              <a
                                href={`/api/projects/${project.id}/report/${f.finding_key}?format=markdown`}
                                className="inline-flex items-center text-ink-tertiary hover:text-accent-600"
                                title={`Download report for "${f.title}" (Markdown)`}
                                download
                              >
                                <Download size={14} />
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

      {tab === "findings" && (
        <div className="py-6">
          {!isOwner ? (
            <div className="flex flex-col items-start gap-4 rounded-md border border-line bg-surface-raised p-6">
              <Lock size={24} className="text-ink-tertiary" />
              <div>
                <h2 className="font-display text-base font-semibold text-ink">Maintainer access required</h2>
                <p className="mt-1 max-w-prose text-sm text-ink-secondary">
                  Detailed findings are visible to verified project maintainers only. Sign in with
                  GitHub to prove admin or maintain access on this repository.
                </p>
              </div>
              <a href={githubLoginUrl(fullName)}>
                <Button>Verify as owner</Button>
              </a>
            </div>
          ) : findingsQ.isLoading ? (
            <ScanningSpinner label="Loading findings…" />
          ) : findingsQ.isError ? (
            <p className="text-sm text-danger">Failed to load findings.</p>
          ) : (
            <OwnerFindingsTable
              items={findingsQ.data?.items ?? []}
              selected={selected}
              setSelected={setSelected}
              onDisclose={() => setConfirmOpen(true)}
              disclosing={discloseM.isPending}
            />
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`Disclose ${selected.size} finding${selected.size === 1 ? "" : "s"} publicly?`}
        body="Titles, descriptions, file paths, and code snippets of the selected findings will become visible to everyone. This cannot be undone."
        confirmLabel="Disclose"
        danger
        busy={discloseM.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => discloseM.mutate()}
      />
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

function OwnerFindingsTable({
  items,
  selected,
  setSelected,
  onDisclose,
  disclosing,
}: {
  items: FindingListItem[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  onDisclose: () => void;
  disclosing: boolean;
}) {
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  };

  if (items.length === 0) {
    return (
      <p className="text-sm text-ink-secondary">No findings for this project yet.</p>
    );
  }

  return (
    <div>
      {selected.size > 0 && (
        <div className="sticky top-14 z-10 mb-3 flex items-center gap-3 rounded-md border border-line bg-surface-raised px-3 py-2">
          <span className="text-sm text-ink-secondary">{selected.size} selected</span>
          <Button variant="danger" onClick={onDisclose} disabled={disclosing}>
            Disclose publicly
          </Button>
          <button
            type="button"
            className="text-sm text-ink-secondary hover:text-ink"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-line bg-surface-sunken/50 text-xs uppercase tracking-wide text-ink-secondary">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={selected.size === items.length && items.length > 0}
                  onChange={toggleAll}
                  aria-label="Select all"
                />
              </th>
              <th className="px-3 py-2.5 font-medium">Sev</th>
              <th className="px-3 py-2.5 font-medium">Title</th>
              <th className="px-3 py-2.5 font-medium">CWE</th>
              <th className="hidden px-3 py-2.5 font-medium md:table-cell">Location</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((f) => {
              const isSel = selected.has(f.id);
              return (
                <tr
                  key={f.id}
                  className={`border-b border-line last:border-0 ${isSel ? "bg-accent-50/60" : "hover:bg-accent-50/40"}`}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={isSel}
                      disabled={f.disclosure_state === "disclosed"}
                      onChange={() => toggle(f.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${f.title}`}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <SeverityChip severity={f.severity} />
                  </td>
                  <td className="max-w-xs truncate px-3 py-3 font-medium text-ink">{f.title}</td>
                  <td className="px-3 py-3 font-mono text-[13px] text-ink-secondary">
                    {f.cwe ?? "—"}
                  </td>
                  <td className="hidden max-w-[12rem] truncate px-3 py-3 font-mono text-[13px] text-ink-tertiary md:table-cell">
                    {f.primary_file ?? "—"}
                  </td>
                  <td className="px-3 py-3 text-[13px]">
                    {f.disclosure_state === "disclosed" ? (
                      <span className="text-success">Disclosed ✓</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-ai-ink">
                        <Sparkles size={12} /> AI-discovered
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
