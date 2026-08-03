import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

const styles: Record<Variant, string> = {
  // 协作者深色体系：主按钮 = 白底黑字（composer submit 同族）
  primary: "bg-[#ebecf0] text-[#0d0d0f] hover:bg-white border border-transparent",
  secondary: "bg-surface-raised text-ink border border-[#333] hover:border-[#484a58] hover:bg-surface-sunken",
  ghost: "bg-transparent text-ink-secondary border border-transparent hover:bg-surface-sunken hover:text-ink",
  danger: "bg-danger text-white hover:bg-[#d63f3f] border border-transparent",
};

// 高度集中在 size prop，禁止 className 覆盖高度（Tailwind 同源类冲突靠 CSS 顺序，不可靠）
const sizes: Record<Size, string> = {
  md: "h-9 px-3.5",
  lg: "h-12 px-5",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors focus-ring disabled:opacity-50 disabled:pointer-events-none ${sizes[size]} ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
