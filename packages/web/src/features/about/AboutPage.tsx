import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export function AboutPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-[13px] text-ink-secondary hover:text-ink"
      >
        <ArrowLeft size={14} /> Projects
      </Link>
      <h1 className="mt-4 font-display text-xl font-bold text-ink">About OpenVuln</h1>
      <div className="mt-4 max-w-prose space-y-4 text-sm leading-relaxed text-ink-secondary">
        <p>
          OpenVuln is a public vulnerability intelligence platform for open-source software.
          Repository maintainers sign in with GitHub to submit their own projects for scanning by
          the <strong className="font-medium text-ink">VulnHunter</strong> AI engine — only
          accounts with admin or maintain permission on a repository can submit it.
        </p>
        <p>
          Aggregate statistics — severity distribution, CWE categories, scan status — are public.
          Detailed findings (titles, paths, code) are visible only to the repository's signed-in
          maintainers, who choose what to disclose. Disclosed findings become fully public, like a
          GitHub Security Advisory.
        </p>
        <p>
          OpenVuln is a lightweight front door to VulnHunter: the heavy analysis runs on a dedicated
          VulnHunter instance; this site focuses on disclosure and discovery.
        </p>
      </div>
    </div>
  );
}
