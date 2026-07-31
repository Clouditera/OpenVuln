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
          OpenVuln is a public vulnerability intelligence platform for open-source software. Anyone
          can submit a public GitHub repository; OpenVuln queues it for scanning by the{" "}
          <strong className="font-medium text-ink">VulnHunter</strong> AI engine.
        </p>
        <p>
          Aggregate statistics — severity distribution, CWE categories, scan status — are public.
          Detailed findings (titles, paths, code) stay private to verified project maintainers until
          they choose to disclose.
        </p>
        <p>
          OpenVuln is a lightweight front door to VulnHunter: the heavy analysis runs on a dedicated
          VulnHunter instance; this site focuses on disclosure and discovery.
        </p>
      </div>
    </div>
  );
}
