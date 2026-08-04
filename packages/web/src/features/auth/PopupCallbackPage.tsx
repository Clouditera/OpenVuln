import { useEffect } from "react";
import { CircleCheck } from "lucide-react";

/**
 * 弹窗 OAuth 完成页：授权后回调落在弹窗里展示。
 * postMessage 通知 opener + 2s 后尝试自动关闭（脚本打开的窗口可关）。
 * 注意：不能用 <script dangerouslySetInnerHTML>（innerHTML 注入的 script 不执行）。
 */
export function PopupCallbackPage() {
  useEffect(() => {
    if (window.opener) {
      try {
        window.opener.postMessage({ type: "ov-oauth-complete" }, "*");
      } catch {
        /* opener 不可达时忽略，原页面轮询兜底 */
      }
    }
    const t = window.setTimeout(() => {
      try {
        window.close();
      } catch {
        /* 浏览器拒绝时由文案兜底 */
      }
    }, 2000);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-8 text-center">
      <CircleCheck size={44} className="text-success" strokeWidth={1.6} />
      <h1 className="mt-4 font-display text-xl font-semibold text-ink">Sign-in complete</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        You can close this tab and return to OpenVuln.
      </p>
    </div>
  );
}
