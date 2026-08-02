import { Link, Outlet, useLocation } from "react-router-dom";
import { Github } from "lucide-react";

const VH_GITHUB = "https://github.com/search?q=vulnhunter&type=repositories";
/** OpenVuln public repo; override at build time via VITE_GITHUB_REPO_URL. */
const OWN_REPO =
  (import.meta.env.VITE_GITHUB_REPO_URL as string | undefined) ||
  "https://github.com/Clouditera/OpenVuln";

export function Layout() {
  const { pathname } = useLocation();
  const isDeck = pathname === "/";
  return (
    <div className="flex min-h-screen flex-col">
      {!isDeck && <header className="sticky top-0 z-30 h-14 border-b border-line bg-surface-header/95 backdrop-blur">
        <div className="flex h-full items-center justify-between gap-4 px-5">
          <div className="flex items-center">
            <Link
              to="/"
              className="font-display text-[17px] font-bold tracking-tight focus-ring rounded-md text-ink"
            >
              OpenVuln
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={OWN_REPO}
              target="_blank"
              rel="noreferrer"
              className="rounded-md p-2 text-ink-secondary hover:bg-surface-sunken hover:text-ink focus-ring"
              title="OpenVuln on GitHub"
            >
              <Github size={18} />
            </a>
          </div>
        </div>
      </header>}

      <main className="flex-1">
        <Outlet />
      </main>

      {!isDeck && (
      <footer className="mt-auto border-t border-line">
        <div className="flex flex-col gap-2 px-5 py-6 text-[13px] text-ink-secondary sm:flex-row sm:items-center sm:justify-between">
          <p>
            © 2026 OpenVuln · Powered by{" "}
            <a
              href={VH_GITHUB}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-ink hover:text-accent-600"
            >
              VulnHunter
            </a>
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <a href={OWN_REPO} target="_blank" rel="noreferrer" className="hover:text-ink">
              GitHub
            </a>
            <Link to="/about" className="hover:text-ink">
              About
            </Link>
          </div>
        </div>
      </footer>
      )}
    </div>
  );
}
