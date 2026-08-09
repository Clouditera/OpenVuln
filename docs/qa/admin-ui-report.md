# openvuln-admin 管理台 v1 验收

> QA：qa ｜ 2026-08-09  
> 环境：本机 http://localhost:5173 → API https://openvuln.vulnhunter.pro  
> 证据：`docs/qa/admin-ui/*.png` + Playwright e2e  

## 结论

**✅ 通过**（核心功能全绿；1 个 minor UX 备注，不阻断）

| # | 检查点 | 结果 |
|---|---|---|
| CORS | localhost:5173 preflight | ✅ `access-control-allow-origin: http://localhost:5173` |
| Token 页 | 未登录展示 Connect | ✅ |
| 错 token | 错误提示 | ⚠️ 显示 401 红条（原始 JSON），但**未清 token、未退回登录页**（见 BUG-ADMIN-1 minor） |
| 正确 token | 进入 Reviews/Queue | ✅ |
| 待审列表 | 渲染提交人 + 项目 + commit | ✅ `qa-owner` · `octocat/Hello-World` · `master 7fd1a60b` · Approve/Reject |
| **Approve（UI）** | 待审消失 → 队列 scanning | ✅ job 真进 VH（state=scanning），Reviews 清空，Queue 出现 |
| **Reject（UI）** | reason + 邮件 + 删除 | ✅ 列表移除；公众 404；日志 `Rejection email sent to qa-review@clouditera.com` |
| 队列总览 | 表头 + state badge + error | ✅ scanning / failed 历史可见 |
| Disconnect | 回 token 页 | ✅ |
| 测试数据 | 自清 | ✅ 无 octocat/* / 无 qa-owner 残留 |

## 证据截图

- `01-token-page.png` — 登录页  
- `02-wrong-token.png` — 错 token 401 红条（仍在主壳）  
- `05-pending-list.png` — 待审卡片（qa-owner + Hello-World + Approve/Reject）  
- `07-queue-after-approve.png` — Approve 后 Queue 显示 Hello-World **scanning**  
- `09-after-reject.png` / `10-disconnect.png`  

## BUG-ADMIN-1 minor — 错 token 不退回登录

- **Actual**：输入错误 ADMIN_TOKEN → Connect 后进入主壳，红条显示原始  
  `401: {"error":{"code":"ERR_UNAUTHORIZED",...,"reason":"invalid_admin_token"}}`  
  且 **Disconnect 才退回**；token 仍写在 localStorage  
- **根因（UI）**：`refresh()` catch 里用**旧 state** `error.includes("401")` 判断是否清 token（闭包陈旧），新错误写进 `setError` 后不会触发清 token  
- **期望**：401 → 友好文案（如「Token 无效」）+ 清 localStorage + 退回 Connect 页  
- **严重度**：minor（不影响正确 token 工作流；内部工具）

## 签字

- task-f6989558（管理台 v1）：**✅ QA 通过**（可交付 fish 日常使用）  
- BUG-ADMIN-1 可选修，不挡发布  
