# 后端大改回归报告（NVD / 去 OAuth / 队列优先级）

> 任务：task-2f630eeb ｜ QA：qa ｜ 2026-08-01  
> 触发：pm No.299 — task-7057d1e1 + task-697b903c 合入后  
> 环境：隔离 `openvuln_qa` + `:17860` + `VULNHUNTER_MOCK=true` + `ADMIN_TOKEN=qa-admin-token-regression`  
> 证据：`docs/qa/regression-2026-08-01/`

## 结论

**✅ 回归通过** — 红线、并发提交、retry 不膨胀、NVD 四档与 info 隐藏、OAuth 移除、ADMIN_TOKEN、队列 stars 优先均符合预期。

可继续加密管理通道实现（task-168568cd）；加密 E2E 另测。

---

## 覆盖矩阵

| # | 场景 | 结果 | 证据 |
|---|---|---|---|
| R0 | health / empty stats 四档 / me 恒匿名 | ✅ | r0-*.json |
| R1 | OAuth login/callback/logout → 403 oauth_removed | ✅ | r1-*.json |
| R2 | admin 无 token/错 token → 401；对 token → 200 | ✅ | r2-*.json |
| R3 | 并发双提交同 repo → 201 + 409 duplicate | ✅ | r3-a/b.json |
| R4/R6 | 队列优先级 stars↓ → created_at↑ | ✅ | 见下 |
| R5 | findings/detail/disclose 恒 403（含带 admin token） | ✅ | r5-*.json |
| R7 | 公众视图 NVD 四档 counts；无 title/path；stats 无 poc_rate | ✅ | r7-*.json |
| R8 | admin retry 后 counts 不膨胀、行数不累加 | ✅ | r8-*.json |
| R9 | 全量公众 JSON 敏感字段扫描 | ✅ | 脚本断言 |
| R10 | admin 下架 → 公众 404 | ✅ | r10-*.json |
| R11 | DB 插入 info 级 → 公众 counts/正文均不出现 | ✅ | r11-with-info.json |

---

## 队列优先级（核心）

提交顺序（created_at）：Hello-World(3739) → git-consortium(595) → Spoon-Knife(13934)  
**首次调度 started_at 顺序**：

1. **Spoon-Knife** (13934) — 最后提交却最先扫描  
2. **Hello-World** (3739)  
3. **git-consortium** (595)

与 `ORDER BY stars DESC, created_at ASC` 一致。  
（R8 对 Hello-World retry 会改写其 started_at，验证优先级请看首次完成时间线 R6，勿用 retry 后的 started_at。）

---

## 红线（去 owner 后）

| 请求 | HTTP | reason |
|---|---|---|
| `GET .../findings` | 403 | owner_self_service_removed |
| `GET .../findings/:key` | 403 | 同上 |
| `POST .../disclose` | 403 | 同上 |
| 带 `ADMIN_TOKEN` 访问 findings | 403 | 同上（披露改走未来加密管理通道，不走此 API） |
| 公众项目页 | 200 | 仅聚合 + 空 disclosed_findings；无 title/path/detail |
| 手动插入 info + 敏感 title | 200 | 正文与 counts 均无 info / 无该 title |

---

## NVD / 统计口径

- `severity_counts` 仅 `critical|high|medium|low`（mock：每项目 critical:1 high:1 medium:1，cvss 9.8/8.1/5.4）
- `finding_total` = 四档之和；**不含 info**
- stats **无** `poc_rate` / `cwe_count`
- 仍有 `trend` / `cwe_top` / `live` / `recent` 扩展字段（非阻断；与早期「欢迎页三项」并存，前端可选用）

## findings_so_far

- completed 后字段为 3，与入库条数一致 ✅  
- scanning 中途 mock 下多为 0（mock 可能仅在完成时暴露 findings）— **观察**：真实 VH 联调时再确认 poller 中途计数；接口已透出

## Retry（BUG-1 回归）

Hello-World retry 前后：`severity_counts` 恒为 `{critical:1,high:1,medium:1,low:0}`；findings 行数保持 3。

## 并发提交（BUG-2 回归）

201 + 409 `duplicate`，无 500。

---

## 观察（不阻断）

| ID | 说明 |
|---|---|
| OBS-A | scanning 期间 `findings_so_far` 在 mock 下常为 0，需真实 VH 验证中途拉取 |
| OBS-B | overview 仍返回 trend/cwe_top 等；pm/设计若只要 Hero 三项，前端忽略即可，非 API 错误 |
| OBS-C | 公众 disclose API 已 403；加密管理通道（task-168568cd）落地前**无法做披露 E2E** |
| OBS-D | 服务日志本次回归 `level=50` 计数 = 0 |

---

## 签字

- **本回归范围**：✅ QA 通过  
- **下一步**：developer 实现加密通道后，qa 做「密文入库 + CLI 解密 + 验签披露 + 公众永不解密」E2E  
- **仍非 release**：真实 VH、前端 UI 全站验收
