import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Github,
  Radar,
  Search,
  Shield,
} from "lucide-react";
import type { LiveScanItem } from "@openvuln/shared";
import { api } from "../../shared/api/client";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ProjectRow } from "../../components/ProjectRow";
import { RepoSubmitForm } from "../../components/RepoSubmitForm";
import { HeroStats } from "../../components/HeroStats";
import { ScanDurationNotice } from "../../components/ScanDurationNotice";
import { AuthButton } from "../../components/AuthButton";
import { NotificationBell } from "../../components/NotificationBell";

const OWN_REPO =
  (import.meta.env.VITE_GITHUB_REPO_URL as string | undefined) ||
  "https://github.com/Clouditera/OpenVuln";
const ZAI_HF_AVATAR = "https://huggingface.co/api/avatars/zai-org";

/** List state survives project-detail navigation. */
const listCache = { sort: "stars" as "newest" | "stars", q: "" };

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function ScanRow({ scan }: { scan: LiveScanItem }) {
  const dispatching = scan.state === "dispatching";

  return (
    <Link
      to={`/p/${scan.full_name}`}
      className="group flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3.5 transition hover:border-white/[0.16] hover:bg-white/[0.06] focus-ring-dark"
    >
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-running/20 bg-running-bg text-running-ink">
        <Radar size={19} className="motion-safe:animate-pulse" />
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#111216] bg-success" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white transition group-hover:text-accent-700">
          {scan.full_name}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-ink-tertiary">
          <span className="inline-flex items-center gap-1.5 text-running-ink">
            <Activity size={11} />
            {dispatching ? "Preparing scan" : "Scanning now"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock3 size={11} />
            {formatElapsed(scan.elapsed_sec)}
          </span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-display text-lg font-semibold tabular-nums text-white">
          {scan.findings_so_far}
        </p>
        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-tertiary">
          found so far
        </p>
      </div>
      <ArrowRight size={15} className="shrink-0 text-ink-tertiary transition group-hover:translate-x-0.5 group-hover:text-white" />
    </Link>
  );
}

function LiveScanPanel({
  scans,
  queued,
  loading,
  failed,
}: {
  scans: LiveScanItem[];
  queued: number;
  loading: boolean;
  failed: boolean;
}) {
  const active = scans.length;

  return (
    <section
      aria-labelledby="live-scan-title"
      className="relative overflow-hidden rounded-[28px] border border-white/[0.1] bg-[#111216]/90 p-5 shadow-[0_28px_100px_rgba(0,0,0,0.42)] backdrop-blur sm:p-6"
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-running/70 to-transparent" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-success-ink">
            <span className="relative flex h-2 w-2">
              {active > 0 && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-50 motion-reduce:hidden" />
              )}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${active > 0 ? "bg-success" : "bg-ink-tertiary"}`} />
            </span>
            Live scanner
          </div>
          <h2 id="live-scan-title" className="mt-2 font-display text-xl font-semibold tracking-tight text-white">
            What OpenVuln is scanning
          </h2>
        </div>
        {!loading && !failed && (
          <div className="rounded-full border border-white/[0.08] bg-black/30 px-3 py-1.5 font-mono text-[10px] text-ink-secondary">
            {active} active · {queued} queued
          </div>
        )}
      </div>

      <div className="mt-5 min-h-[148px]">
        {loading ? (
          <div className="space-y-2.5" aria-label="Loading live scans">
            {[0, 1].map((item) => (
              <div key={item} className="h-[70px] animate-pulse rounded-2xl bg-white/[0.045]" />
            ))}
          </div>
        ) : failed ? (
          <div className="flex min-h-[148px] items-center justify-center rounded-2xl border border-dashed border-white/[0.1] bg-black/20 px-5 text-center">
            <div>
              <Activity size={22} className="mx-auto text-ink-tertiary" />
              <p className="mt-2 text-sm font-medium text-ink-secondary">Live data is unavailable</p>
              <p className="mt-1 text-xs text-ink-tertiary">The scanner status will reconnect automatically.</p>
            </div>
          </div>
        ) : scans.length > 0 ? (
          <div className="space-y-2.5">
            {scans.map((scan) => <ScanRow key={scan.project_id} scan={scan} />)}
          </div>
        ) : (
          <div className="flex min-h-[148px] items-center justify-center rounded-2xl border border-dashed border-white/[0.1] bg-black/20 px-5 text-center">
            <div>
              <CheckCircle2 size={23} className="mx-auto text-success-ink" />
              <p className="mt-2 text-sm font-medium text-white">Scanner is ready</p>
              <p className="mt-1 text-xs leading-5 text-ink-tertiary">
                No repository is being scanned right now{queued > 0 ? ` · ${queued} waiting` : ""}.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.05]" aria-hidden>
        <div className={`h-full rounded-full bg-gradient-to-r from-accent-600 via-ai to-success ${active > 0 ? "live-scan-sweep w-1/3" : "w-0"}`} />
      </div>
    </section>
  );
}

export function ProductHomePage() {
  const [q, setQState] = useState(listCache.q);
  const [sort, setSortState] = useState<"newest" | "stars">(listCache.sort);
  const setQ = (value: string) => {
    listCache.q = value;
    setQState(value);
  };
  const setSort = (value: "newest" | "stars") => {
    listCache.sort = value;
    setSortState(value);
  };

  const overview = useQuery({
    queryKey: ["public", "overview"],
    queryFn: api.overview,
    refetchInterval: 15_000,
  });

  const pageSize = 20;
  const projects = useInfiniteQuery({
    queryKey: ["public", "projects", sort],
    queryFn: ({ pageParam }) => api.listProjects({ sort, page: pageParam, page_size: pageSize }),
    initialPageParam: 1,
    getNextPageParam: (last, _pages, lastParam) =>
      lastParam * pageSize < (last.total ?? 0) ? lastParam + 1 : undefined,
  });
  const allItems = useMemo(() => projects.data?.pages.flatMap((page) => page.items) ?? [], [projects.data]);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && projects.hasNextPage && !projects.isFetchingNextPage) {
          void projects.fetchNextPage();
        }
      },
      { rootMargin: "320px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [projects.hasNextPage, projects.isFetchingNextPage, projects.fetchNextPage]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return allItems;
    return allItems.filter(
      (project) =>
        project.full_name.toLowerCase().includes(needle) ||
        (project.description ?? "").toLowerCase().includes(needle),
    );
  }, [allItems, q]);

  const scans = overview.data?.live?.scanning ?? [];
  const queued = overview.data?.live?.queued_count ?? 0;

  return (
    <div id="top" className="openvuln-home relative isolate min-h-screen overflow-hidden bg-black text-white">
      <div className="openvuln-glow pointer-events-none fixed inset-0 -z-10" />

      <header className="sticky inset-x-0 top-0 z-30 border-b border-white/[0.07] bg-black/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link to="/" className="openvuln-title rounded-md font-display text-[17px] font-bold tracking-tight focus-ring-dark">
            OpenVuln
          </Link>
          <div className="flex items-center gap-2">
            <NotificationBell appearance="dark" />
            <AuthButton appearance="dark" />
            <a
              href={OWN_REPO}
              target="_blank"
              rel="noreferrer"
              aria-label="OpenVuln on GitHub"
              className="inline-flex h-9 items-center gap-2 rounded-full border border-[#333] bg-[#080808] px-3.5 text-xs font-medium text-[#acacb0] transition hover:border-[#484a58] hover:bg-[#111216] hover:text-white focus-ring-dark"
            >
              <Github size={14} />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-5 pb-16 pt-12 sm:px-8 sm:pt-16">
        <section className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <div className="openvuln-brand flex items-center justify-center gap-4 sm:gap-5">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-white text-2xl font-bold text-black shadow-[0_14px_44px_rgba(0,0,0,0.4)] sm:h-16 sm:w-16">
              <span aria-hidden>Z</span>
              <img
                src={ZAI_HF_AVATAR}
                alt="Z.ai"
                className="absolute inset-0 h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            </div>
            <h1 className="openvuln-title font-display text-[40px] font-[450] leading-none tracking-normal sm:text-[64px]">
              OpenVuln
            </h1>
          </div>

          <p className="mt-6 max-w-2xl text-balance text-base leading-7 text-ink-secondary sm:text-lg">
            AI-powered vulnerability discovery for the open-source world.
          </p>

          <RepoSubmitForm size="hero" appearance="dark" className="mt-8 w-full max-w-2xl" />
          <ScanDurationNotice className="mt-3 w-full max-w-2xl" />
        </section>

        <div className="mx-auto mt-10 max-w-5xl sm:mt-12">
          <LiveScanPanel
            scans={scans}
            queued={queued}
            loading={overview.isLoading}
            failed={overview.isError}
          />
        </div>

        <HeroStats stats={overview.data} loading={overview.isLoading} failed={overview.isError} />

        <section aria-labelledby="projects-title" className="mt-16 border-t border-white/[0.08] pt-10 sm:mt-20 sm:pt-12">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-600">Repository index</p>
              <h2 id="projects-title" className="mt-2 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Scanned repositories
              </h2>
              <p className="mt-2 text-sm text-ink-tertiary">Browse public scan status and disclosed results.</p>
            </div>
            <div className="flex flex-col gap-2.5 sm:items-end">
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-tertiary" />
                <input
                  type="search"
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder="Search repositories"
                  aria-label="Search repositories"
                  className="h-10 w-full rounded-xl border border-white/[0.1] bg-[#111216] pl-10 pr-3 text-sm text-white placeholder:text-ink-tertiary focus-ring-dark sm:w-72"
                />
              </div>
              <div className="inline-flex self-start rounded-lg border border-white/[0.09] bg-[#0a0a0b] p-1 sm:self-auto" aria-label="Sort repositories">
                <button
                  type="button"
                  aria-pressed={sort === "stars"}
                  onClick={() => setSort("stars")}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition focus-ring-dark ${sort === "stars" ? "bg-white text-black" : "text-ink-tertiary hover:text-white"}`}
                >
                  Most starred
                </button>
                <button
                  type="button"
                  aria-pressed={sort === "newest"}
                  onClick={() => setSort("newest")}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition focus-ring-dark ${sort === "newest" ? "bg-white text-black" : "text-ink-tertiary hover:text-white"}`}
                >
                  Recently added
                </button>
              </div>
            </div>
          </div>

          <div className="mt-7 border-t border-line">
            {projects.isLoading ? (
              <div className="space-y-3 py-6">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="h-24 animate-pulse rounded-xl bg-surface-raised" />
                ))}
              </div>
            ) : projects.isError ? (
              <EmptyState icon={Shield} title="Could not load repositories" description="The OpenVuln API may be unavailable." />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Shield}
                title={q ? "No matching repositories" : "No repositories yet"}
                description={q ? "Try a different repository name." : "Submit the first open-source repository to be scanned by VulnHunter."}
                action={!q ? <Link to="/submit"><Button>Submit a repository</Button></Link> : undefined}
              />
            ) : (
              <>
                {filtered.map((project) => <ProjectRow key={project.id} project={project} />)}
                <div ref={sentinelRef} className="h-px" />
                {projects.isFetchingNextPage && (
                  <div className="py-5 text-center font-mono text-xs text-ink-tertiary">Loading more…</div>
                )}
              </>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 font-mono text-[11px] text-ink-tertiary">
            <span>{(projects.data?.pages[0]?.total ?? 0).toLocaleString()} repositories indexed</span>
            <a href="#top" className="hover:text-white">Back to top ↑</a>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.08]">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-7 text-[12px] text-ink-tertiary sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© 2026 OpenVuln · Powered by VulnHunter</p>
          <div className="flex gap-5">
            <a href={OWN_REPO} target="_blank" rel="noreferrer" className="hover:text-white">GitHub</a>
            <Link to="/about" className="hover:text-white">About</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
