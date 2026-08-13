import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <Icon size={32} className="text-ink-tertiary" strokeWidth={1.5} />
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        {description && (
          <p className="mt-1 max-w-sm text-[13px] text-ink-secondary">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
