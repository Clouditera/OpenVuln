import { CircleAlert, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import type { Severity } from "@openvuln/shared";
import { severityLabel } from "../shared/lib/format";

const icon = {
  high: OctagonAlert,
  medium: TriangleAlert,
  low: CircleAlert,
  info: Info,
} as const;

const cls = {
  high: "bg-sev-high-bg text-sev-high-ink",
  medium: "bg-sev-medium-bg text-sev-medium-ink",
  low: "bg-sev-low-bg text-sev-low-ink",
  info: "bg-sev-info-bg text-sev-info-ink",
} as const;

export function SeverityChip({ severity }: { severity: Severity }) {
  const Icon = icon[severity];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls[severity]}`}
    >
      <Icon size={12} strokeWidth={2} />
      {severityLabel(severity)}
    </span>
  );
}
