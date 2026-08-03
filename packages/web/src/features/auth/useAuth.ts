import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type MeResponse } from "../../shared/api/client";

/** 当前登录态。未配置后端的旧部署会 404 → 按未登录降级。 */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    staleTime: 60_000,
    retry: false,
  });
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
