# 版本绑定扫描验收（task-60217366 + BUG-VB-1/2）

> QA：qa ｜ 2026-08-06（含回归）  
> 环境：生产 https://openvuln.clouditera.com（migration 011）  

## 结论

**✅ 通过**

| 项 | 结果 |
|---|---|
| 扫描历史（owner） | ✅ GLM-4 两版本：v1 17 + v2 19 |
| scans 匿名 / 陌生人 | ✅ 401 / 403 |
| 同版本幂等 | ✅ 返回既有 completed，不新建 |
| 单进行中 DB 约束 | ✅ `one_inflight_per_project` |
| **cancel queued（owner）** | ✅ **200** `{"ok":true,"state":"cancelled"}` |
| cancel 匿名 / 陌生人 | ✅ 401 / 403 |
| cancel 已完成 job | ✅ **409** |
| cancel 不存在 job | ✅ 404 |
| **BUG-VB-2 redis 唯一 completed** | ✅ 仅 1 条 `9b47718b`（22 findings） |
| redis 数据 | ✅ 22 无回归 |
| migration | ✅ 010 + **011**（CHECK 含 cancelled） |

---

## BUG-VB-1 回归

- `POST /api/projects/:id/scan-jobs/:jobId/cancel`（owner · queued）→ **200**，DB `state='cancelled'`  
- 旧 500 `scan_jobs_state_check` 已消（011 migration + 手工 ALTER 已生效）  
- 矩阵：anon **401** / stranger **403** / completed **409** / missing **404** / owner **200**

## BUG-VB-2 回归

- redis scan_jobs：仅 **1 条 completed**（`9b47718b`，22 findings）；旧空 job 已删  
- 公众 counts 仍 **c3/h4/m14/l1**  

## 说明

- cancel 对 **scanning** 中 job 的 VH DELETE 联动未真实消耗触发（避免烧 token）；queued 与 completed 边界已验，代码路径统一  
- 版本绑定后端 + 两 BUG 修复均已签字  

## 签字

- **task-60217366**：**✅**  
- **task-afbe8277 BUG-VB-1**：**✅**  
- **task-fbc08dfd BUG-VB-2**：**✅**  
