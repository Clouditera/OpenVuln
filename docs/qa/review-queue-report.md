# 审核制（后台审核队列）后端验收

> QA：qa ｜ 2026-08-09
> 环境：生产 https://openvuln.vulnhunter.pro（migration 012_review_states）

## 结论

**✅ 通过** —— 审核制后端六个检查点全部验收通过（含 approve→真扫描端到端、reject 修复回归）。

## 验收清单核对

| # | 检查点 | 结果 |
|---|---|---|
| ① | 新提交进入 `pending_review`（不自动派发） | ✅ PASS —— Hello-World 提交后 `state=pending_review`，commit `7fd1a60b01`；8s 后仍为 pending_review，未被 dispatcher 捞起 |
| ② | approve → queued → 正常派发 | ✅ PASS —— approve→queued→dispatching→**VH task 创建（taskId bd5ea16b，zipball 上传成功）→scanning**，真 VH 端到端跑通 |
| ③ | reject → 提交者收拒绝邮件 + 记录删除 | ✅ PASS（BUG-RQ-1 修复后回归）—— reject 200 + 真实 SMTP 发信成功 + 记录删除 |
| ④ | 匿名/非 admin 调 admin 端点 | ✅ PASS —— anon 401 / 错误 Bearer 401 / 陌生 session 401 / 普通 owner session 401 / 有效 ADMIN_TOKEN 200 |
| ⑤ | 现有 6 项目无回归 | ✅ PASS —— opencode/pi-subagents/CogVideo/GLM-4/GLM-4.5/GLM-5 全部在列 |
| ⑥ | 四态映射 API 输出 | ✅ PASS —— 公众详情返回 `pending_review`（前端映射 In review）；completed 正常 |

## BUG-RQ-1 — reject 端点损坏（major / P0）

- **Repro**：`POST /api/admin/scan-jobs/:id/reject`（有效 admin token，目标为 pending_review job）
- **Actual**：**500 ERR_INTERNAL**；日志 `PostgresError: relation "users" does not exist`（`features/admin/routes.js:160`）
- **根因**：reject 查询了不存在的 `users` 表（schema 中是 `github_identities`）
- **影响**：拒绝路径完全不可用 —— 不发拒绝邮件、不删除记录，管理员无法拒绝任何提交
- **Fix**：把 `users` 改为 `github_identities`（取提交者 email 走 `github_identities.email`）；回归 reject→200 + 邮件发送 + 记录删除

### 回归（de9d92f）✅
- reject → **HTTP 200** `state:"rejected"`
- 拒绝邮件经真实 SMTP（feishu）发送成功：`Rejection email sent to qa-review@clouditera.com`
- 记录已删（job=0 / project=0）；reject 不存在 job → **404**
- **BUG-RQ-1 签字通过（task-189eea14 done）**

## INFRA — VH 跨机接入（已解决 ✅ task-fcc738eb done）

- 原状：`VULNHUNTER_BASE_URL=http://47.94.46.24:28080` 直连被安全组挡（新机/我本机均 Connect Timeout；旧机 localhost 正常）
- **解决**：developer 改为 `https://vulnhunter.pro`（443 nginx 代理，公网可达），**安全组无需改**
- **回归实测 approve→真扫描**：approve → queued → **scanning**（5s）；日志 `Dispatching scan job to VH` → `VH task created from archive`（taskId `bd5ea16b…`，487B zipball 上传成功）→ `Scan job dispatched`；`vulnhunter_task_id` 链接，public state=scanning
- **body-size 担忧排除**：12MB POST 探针返回 401（auth 拦截）而非 413 → nginx 代理放行 ≥12MB，~10MB zipball 无 413 风险

## 测试数据

已在生产库清理：octocat/Hello-World、octocat/Spoon-Knife 项目 + qa-owner/qa-stranger 测试身份/授权/会话全部删除。现存 9 行项目（6 completed + 3 历史 failed）均为既有数据。

## 签字

- **审核制后端：✅ 全部通过** —— 六个检查点含 approve→真扫描端到端、reject（BUG-RQ-1 回归）、权限、四态映射、无回归
- BUG-RQ-1（task-189eea14）✅ / INFRA VH 接入（task-fcc738eb）✅ 均 done
- 说明：Hello-World 扫描在 VH 正常进行（README 仓库，预计 0 发现）；收割路径历史已证（GLM-4/redis），不在本次范围
