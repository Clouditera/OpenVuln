import type { RepoAccessRole } from "../domain.js";

export interface MeResponse {
  authenticated: boolean;
  user: {
    github_user_id: number;
    login: string;
    avatar_url: string | null;
    is_admin: boolean;
  } | null;
  grants: Array<{
    github_repo_id: number;
    project_id: string | null;
    full_name: string | null;
    role: RepoAccessRole;
    verified_at: string;
  }>;
}
