import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isEmbedded, type MeResponse } from "../../shared/api/client";

/** 当前登录态。 */
export function useMe() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    staleTime: 0, // always refetch on invalidate (needed for popup polling)
    retry: false,
  });

  // Listen for popup OAuth completion signal — popup sends user data directly
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "ov-oauth-complete" && e.data.user) {
        // Popup fetched /api/me in top-level context (cookie works there)
        qc.setQueryData(["me"], e.data.user as MeResponse);
        qc.invalidateQueries({ queryKey: ["owner-findings"] });
      } else if (e.data?.type === "ov-oauth-complete") {
        // Fallback: no user data, try refetch
        qc.invalidateQueries({ queryKey: ["me"] });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [qc]);

  // Poll /api/me continuously when embedded (iframe), since postMessage
  // may not work in sandbox. This is the PRIMARY auth detection channel for iframe.
  useEffect(() => {
    if (!isEmbedded()) return; // only poll when inside iframe
    const interval = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["me"] });
    }, 2000);
    return () => clearInterval(interval);
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
