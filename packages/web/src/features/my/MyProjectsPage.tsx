import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FolderGit2 } from "lucide-react";
import { api } from "../../shared/api/client";
import { useMe } from "../auth/useAuth";
import { ProjectRow } from "../../components/ProjectRow";
import { EmptyState } from "../../components/EmptyState";

/** 我的提交（fish No.929）：登录用户看自己提交过的项目。 */
export function MyProjectsPage() {
  const meQ = useMe();
  const nav = useNavigate();
  const authed = meQ.data?.authenticated === true;

  const listQ = useQuery({
    queryKey: ["my", "projects"],
    queryFn: api.myProjects,
    enabled: authed,
    retry: false,
  });

  if (meQ.isSuccess && !authed) {
    // 未登录：回首页登录
    nav("/", { replace: true });
    return null;
  }

  const projects = listQ.data?.projects ?? [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-[13px] text-ink-secondary hover:text-ink"
      >
        <ArrowLeft size={14} /> Projects
      </Link>
      <h1 className="mt-4 font-display text-xl font-bold text-ink">My submissions</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Projects you submitted for scanning. Sign in with the same GitHub account to see scan
        results and manage disclosures.
      </p>

      <div className="mt-6 border-t border-line">
        {listQ.isPending ? (
          <div className="space-y-3 py-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-surface-raised" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title="No submissions yet"
            description="Submit a public GitHub repository you maintain — it shows up here."
            action={
              <Link
                to="/submit"
                className="inline-flex h-9 items-center rounded-md bg-[#ebecf0] px-3.5 text-sm font-medium text-[#0d0d0f] hover:bg-white"
              >
                Submit a project
              </Link>
            }
          />
        ) : (
          projects.map((p) => <ProjectRow key={p.id} project={p} />)
        )}
      </div>
    </div>
  );
}
