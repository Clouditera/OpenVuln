import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProjectCard } from "@openvuln/shared";
import { formatRelativeTime, formatStars, totalFindings } from "../shared/lib/format";
import { SeverityBar } from "./SeverityBar";
import { StatusBadge } from "./StatusBadge";

function OwnerAvatar({ owner }: { owner: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-50 text-xs font-semibold text-accent-700"
        aria-hidden
      >
        {owner.slice(0, 1).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={`https://github.com/${owner}.png?size=64`}
      alt=""
      width={32}
      height={32}
      className="h-8 w-8 shrink-0 rounded-full border border-line bg-surface-sunken"
      onError={() => setFailed(true)}
    />
  );
}

export function ProjectRow({ project }: { project: ProjectCard }) {
  const nav = useNavigate();
  const state = project.latest_scan?.state;
  const scanning = state === "scanning" || state === "dispatching";
  const waiting = state !== "completed" && !scanning;
  const soFar = project.latest_scan?.findings_so_far ?? 0;
  const findings = totalFindings(project.severity_counts);

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => nav(`/p/${project.owner_login}/${project.name}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter") nav(`/p/${project.owner_login}/${project.name}`);
      }}
      className="group block cursor-pointer border-b border-line px-1 py-4 transition-colors hover:bg-accent-50/40 focus-ring rounded-sm"
    >
      <div className="flex items-start gap-3">
        <OwnerAvatar owner={project.owner_login} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate text-sm font-medium text-ink group-hover:text-accent-700">
                  {project.full_name}
                </span>
              </div>
              {project.description && (
                <p className="mt-0.5 line-clamp-1 text-[13px] text-ink-secondary">
                  {project.description}
                </p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-tertiary">
                {project.language && (
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent-600/70" />
                    {project.language}
                  </span>
                )}
                <span>·</span>
                <span>★ {formatStars(project.stars)}</span>
                {project.latest_scan?.finished_at && (
                  <>
                    <span>·</span>
                    <span>scanned {formatRelativeTime(project.latest_scan.finished_at)}</span>
                  </>
                )}
                {!waiting && findings > 0 && (
                  <>
                    <span>·</span>
                    <span className="font-mono">{findings} findings</span>
                  </>
                )}
              </div>
              {/* waiting: status only on right badge (fish No.1684) — no duplicate In review under meta */}
              {(scanning || !waiting) && (
                <div className="mt-2.5">
                  {scanning ? (
                    <span className="text-[13px] font-medium text-running-ink">
                      {soFar > 0 ? `Scanning · ${soFar} findings so far` : "Scanning…"}
                    </span>
                  ) : (
                    <SeverityBar
                      counts={project.severity_counts}
                      showLegend
                      legendClass="text-[11px]"
                    />
                  )}
                </div>
              )}
            </div>
            {/* completed 的扫描时间已在 meta 行，右侧 badge 只留给需要注意的状态（去重，fish v1.11） */}
            {state !== "completed" && (
              <div className="shrink-0 pt-0.5">
                <StatusBadge state={state} finishedAt={project.latest_scan?.finished_at} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
