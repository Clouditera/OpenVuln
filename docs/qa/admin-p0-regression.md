# 管理台 P0 回归（多版本管理 + 批量 + 审计 + 搜索）

> QA：qa ｜ 2026-08-09  
> 后端 `d800cb6` · 前端 `55c7a33` · migration 014  
> 环境：http://192.168.31.77:5173 → https://openvuln.vulnhunter.pro  

## 结论

**⚠️ 条件通过** —— 搜索 / 审计 / set-current / 批量 approve·delete_jobs / 按版本 Findings / UI 入口大体达标；  
**按版本删除 completed 扫描未交付**（与「只删 v1 留 v2」冲突），见 BUG-ADMIN-5。

## 通过项

| # | 项 | 结果 |
|---|---|---|
| Search API | `q=opencode` → 2 hits（v1/v2）；`q=024d8fd` → GLM-4 | ✅ |
| Search UI | Search tab 输入 opencode → 两行结果 | ✅（API 200 + 表渲染） |
| Audit | migration 014；写 set_current / batch_approve / batch_delete_job 后 `GET /audit-log` 有记录；UI Audit tab + action 过滤 | ✅ |
| Set Current | POST completed v1 → 200，`current_scan_job_id` 切到 v1；审计 `set_current` | ✅ |
| Batch approve | pending_review → queued，`results[].ok=true`；审计 `batch_approve` | ✅ |
| Batch delete_jobs | failed job → ok；审计 `batch_delete_job` | ✅ |
| 按版本 Findings | GET `/scan-jobs/:id/findings` opencode v2=5 / v1=3；UI Findings 按钮 | ✅ |
| 多版本操作入口 | completed 上 **Set Current / Resync / Findings**；inflight 才 Finalize；disclosed 才 Undisclose | ✅ 按状态显隐合理 |
| 批量 UI | Reviews Batch Approve/Reject；Queue Batch Delete Terminal；Projects 批量删 | ✅ 入口在 |
| 旧功能 | Settings / Health / Users / Tabs | ✅ 无回归 |
| 测试数据 | qa-p0 全清 | ✅ |

## 缺口 / 缺陷

### BUG-ADMIN-5 major — 不能删除 **completed** 版本 job

- **需求**（pm/fish P0）：按版本删除（只删 v1，保留 v2）  
- **Actual**：
  - API：`DELETE /api/admin/scan-jobs/:id` 对 **completed** → **409** `not_deletable`（仅 failed/cancelled/rejected）  
  - UI：completed 版本卡片 **不显示 Delete**（条件 `failed|cancelled|rejected`）  
- **影响**：多版本「单独管理」无法清掉旧 completed 版，只能删整个项目  
- **Fix 建议**：允许删除 **非 current** 的 completed job（级联 findings）；若是 current 则 409 或要求先 set-current 到其他版；UI 对 completed 非 current 显示 Delete  

### 设计说明（非 bug）

- **Finalize**：仅 scanning/dispatching 显示 —— 正确  
- **Undisclose**：仅 `disclosure_state=disclosed` 的 finding 显示 —— 正确（当前生产无 disclosed 样本，入口代码在）  
- Audit 在无操作时为空列表 —— 正常；本轮写操作后已有 5+ 条  

## 证据

- API：set-current 200；batch approve→queued；audit 含 set_current/batch_*  
- UI 截图：`docs/qa/admin-ui/p0-*.png`、`p0-search-debug.png`（Search 两行 opencode）  
- 版本展开：Set Current / Resync / Findings / Delete（终态）标签可见  

## 签字

- Search + Audit + Set Current + Batch + Findings：**✅**  
- **按版本删 completed**：**❌ BUG-ADMIN-5**  
- task-c94d85ff：**条件通过**；修 BUG-ADMIN-5 后可完全签字  
