import { Clock3 } from "lucide-react";

/** 扫描时长提示：小 note 样式（fish No.916）—— 时钟小图标 + 一行小字，无卡片无边框。 */
export function ScanDurationNotice({ className = "" }: { className?: string }) {
  return (
    <p
      className={`flex items-center justify-center gap-1.5 text-xs text-[#77787e] ${className}`}
      role="note"
    >
      <Clock3 size={13} strokeWidth={1.8} className="shrink-0" />
      <span>
        A full scan usually takes 12+ hours — you can close this page; results appear here
        automatically.
      </span>
    </p>
  );
}
