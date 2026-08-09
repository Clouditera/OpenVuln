# 管理台 v2 全面回归

> QA：qa ｜ 2026-08-09（含三 BUG 修复后回归）  
> 环境：http://192.168.31.77:5173 → https://openvuln.vulnhunter.pro  
> 证据：`docs/qa/admin-ui/v2-*.png`

## 结论

**✅ 通过**

| Bug | 结果 |
|---|---|
| **BUG-ADMIN-2** 删项目（有 findings） | ✅ DELETE → **200** `{ok:true}`；project/jobs/findings 行全 0 |
| **BUG-ADMIN-3** 删终态 job（有 findings） | ✅ DELETE → **200**；findings=0、job=0；空壳 project 再删 200 |
| **BUG-ADMIN-4** 多版本 | ✅ 列表 `scan_count`；详情 `scans[]`；UI 点 `2 ▾` 展开 **v2.0 (5) + v1.0 (3)** |

## API 回归

| 项 | 结果 |
|---|---|
| `GET /api/admin/projects` | ✅ 含 `scan_count`（opencode=2）+ finding_count |
| `GET /api/admin/projects/:id` | ✅ opencode `scans` 2 条：v2.0/bbbb2222/5 · v1.0/aaaa1111/3 |
| `DELETE /api/admin/projects/:id`（2 findings） | ✅ 200，级联清空 |
| `DELETE /api/admin/scan-jobs/:id`（failed+1 finding） | ✅ 200，级联清空 |
| `GET /api/admin/scan-config` | ✅ audit_focus 432 字 · concurrency 2 |
| `GET /api/admin/system-health` | ✅ VH/GitHub/SMTP 全 ok |

## UI 回归（Playwright · docker 管理台）

| 项 | 结果 |
|---|---|
| 错 token | ✅ 留在 Connect 页（BUG-ADMIN-1 已修） |
| Tabs | ✅ Reviews / Queue / Projects / Settings / Health / Users |
| Settings | ✅ Scan Config 可见 |
| Health | ✅ Recheck + 三系统 |
| Projects 列表 | ✅ 筛选条 + 分页 + Scans 列 + Delete |
| **多版本展开** | ✅ 点 opencode `2 ▾` → v2.0 bbbb2222 5 findings · v1.0 aaaa1111 3 findings（截图 v2-04b-expand.png） |
| Queue / Reviews | ✅ 可打开（当前队列空，cancel/retry/finalize 按钮逻辑既有；approve/reject v1 已签） |

## 测试数据

自造 `qa-reg/*` + `QA-REG*` findings 已全部清零，生产 5 项目无误伤。

## 备注（非阻断）

- `scan_count` API 以 **string** 返回（`"2"`），UI 展示正常；可选改为 number。
- 本轮 Queue 为空，未再点 cancel/retry/finalize 真按钮（端点与 UI 入口先前已验）；删除/多版本为本轮焦点。

## 签字

- task-a7e8c2d1 BUG-ADMIN-2：**✅**  
- task-8989a76f BUG-ADMIN-3：**✅**  
- task-d61eac2b BUG-ADMIN-4：**✅**  
- 管理台 v2 可交付日常使用  
