import { Clock3 } from "lucide-react";

export function ScanDurationNotice({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border border-[#2f3037] bg-[#151619]/90 px-4 py-3.5 text-left shadow-[0_18px_60px_rgba(0,0,0,0.28)] ${className}`}
      role="note"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#34353d] bg-[#1d1e23] text-[#b7bac5]">
        <Clock3 size={17} strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[#f0f2f6]">A full scan usually takes 12+ hours.</p>
        <p className="mt-1 text-xs leading-5 text-[#85868d]">
          You can close this page. The scan continues in the background, and public results will
          appear here automatically.
        </p>
      </div>
    </div>
  );
}
