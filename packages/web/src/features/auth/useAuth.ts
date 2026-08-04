import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type MeResponse } from "../../shared/api/client";

/** 当前登录态。未配置后端的旧部署会 404 → 按未登录降级。 */
export function useMe() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    staleTime: 60_000,
    retry: false,
  });

  // Listen for popup OAuth completion signal
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "ov-oauth-complete") {
        qc.invalidateQueries({ queryKey: ["me"] });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [qc]);

  // When popup is open, poll /api/me every 1.5s for up to 2 min
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const startPolling = () => {
      if (interval) return;
      interval = setInterval(() => {
        qc.invalidateQueries({ queryKey: ["me"] });
      }, 1500);
      timeout = setTimeout(() => {
        if (interval) clearInterval(interval);
        interval = null;
      }, 120_000);
    };
    const onFocus = () => qc.invalidateQueries({ queryKey: ["me"] });
    window.addEventListener("focus", onFocus);
    window.addEventListener("ov-oauth-popup-opened", startPolling);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("ov-oauth-popup-opened", startPolling);
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
    };
  }, [qc]);

  return q;
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      const anon: MeResponse = { authenticated: false, user: null };
      qc.setQueryData(["me"], anon);
      // owner 视图数据全部作废
      qc.invalidateQueries({ queryKey: ["owner-findings"] });
    },
  });
}
