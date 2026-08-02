import { CircleAlert, OctagonAlert, Siren, TriangleAlert } from "lucide-react";
import type { Severity } from "@openvuln/shared";
import { severityLabel } from "../shared/lib/format";

const icon = {
  critical: Siren,
  high: OctagonAlert,
  medium: TriangleAlert,
  low: CircleAlert,
} as const;

const cls = {
  critical: "bg-sev-critical-bg text-sev-critical-ink",
  high: "bg-sev-high-bg text-sev-high-ink",
  medium: "bg-sev-medium-bg text-sev-medium-ink",
  low: "bg-sev-low-bg text-sev-low-ink",
} as const;

export function SeverityChip({ severity }: { severity: Severity }) {
  const Icon = icon[severity] ?? CircleAlert;
  const style = cls[severity] ?? cls.low;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style}`}
    >
      <Icon size={12} strokeWidth={2} />
      {severityLabel(severity)}
    </span>
  );
}
