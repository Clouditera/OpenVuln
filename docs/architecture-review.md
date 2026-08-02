# OpenVuln 架构审查报告

> 任务：task-173903b8 ｜ 触发：fish No.372 ｜ 审查人：architect ｜ 2026-08-02
> 基线：docs/architecture-prototype.md + docs/crypto-admin-channel.md + 后续演进决策

## 总体结论

**架构主干健康**：单进程形态、DB 队列、加密通道、公众红线、client 三模式隔离均按设计落地，QA 的 E2E 也验证了主链路。本次发现 **2 个 P1 正确性缺陷**（公众统计口径、同步非事务）、**3 组 P2 纪律/部署债务**、若干 P3 观察项。没有方向性问题，全是可定点修复的工程项。

## 一、符合项（落地良好，抽查验证）

| 项 | 证据 |
|---|---|
| DB 队列 + 优先级 | `claimQueuedJobs` 事务内 `FOR UPDATE SKIP LOCKED`，`ORDER BY stars DESC, created_at ASC`（fish 的优先级要求已实现） |
| VulnHunterClient 三模式 | mock/cookie/token 实现完整，env 切换，接口与架构文档一致 |
| 加密通道 | 信封 `OVENC1.<kid>.<wrapped>.<iv>.<tag>.<ct>`、AAD=finding.id、PSS 验签、canonical JSON、nonce 表 —— 与设计逐条吻合；service 源码无 `privateDecrypt` |
| 公众红线 | 公开查询全部列白名单（`listDisclosedSummaries` 只取 `disclosed_*`），report-package 只吐密文 |
| 失败封闭 | `ADMIN_TOKEN` 空 → admin 全拒；`requireAdminToken` 用 `timingSafeEqual` |
| 队列故障语义 | 异常标 failed + 手动恢复，符合 fish No.369 要求 |

## 二、P1 缺陷（正确性，建议立即修）

### P1-1 公众统计跨 scan_job 聚合 —— 重扫翻倍 + 失败残留

**现象**：`findings/storage.ts` 所有公众聚合（`severityCounts` / `severityCountsMany` / `cweDistribution` / `listDisclosedSummaries` / `platformSeverityCounts`）只按 `project_id` 聚合，**不限定 scan_job**。

两个可复现场景：
1. **重扫进行中**：scanning 阶段 `replaceAll=false`，新 job 的行逐条 upsert 进表，而旧 completed job 的行还在 → 公众 severity 计数 = 旧全量 + 新增量，**翻倍窗口**直到完成
2. **扫描失败**：`markFailed` 后，scanning 阶段写入的部分 findings **残留**，与上一次 completed 的结果混合计入公众统计

**修复**（推荐）：公众聚合限定「该项目最近一次 completed 的 scan_job」—— 子查询取 job id 再聚合。so_far 已走 `countPublicForScanJob(scanJobId)` 正是这个思路，佐证方向正确。附带收益：重扫期间旧披露结果持续可见（UX 更好），首扫时 severity_counts=0 而 so_far 实时涨，语义干净分离。

### P1-2 syncFindings 非事务 + 轮询重入 —— 数据丢失窗口

**现象**（`scans/queue.ts`）：
1. `replaceAll=true` 时 `deleteAllForProject` 之后**逐条** insert，无事务包裹。进程在此窗口崩溃 → 项目 findings 半空；更严重的是**披露保留机制失效**：`priorDisclosure` 是删除前读进内存的 Map，崩溃即丢失 → 披露决策永久丢失（C8b 保护的就是这个）
2. `setInterval` 无重入保护：大项目 sync 超过 30s 轮询周期时 `pollOnce` 重叠执行，两个 delete+insert 序列交叉写

**修复**：
- replaceAll 全序列（读披露 → delete → 逐条 insert）包进单个 `db.begin()` 事务 —— 崩溃=回滚=旧数据与披露决策都在
- dispatcher/poller tick 加 `tickRunning` 布尔防重入（各自独立）
- 顺手：`applyDisclose` 的循环 UPDATE 也包事务（披露操作的原子性同理）

## 三、P2 债务（纪律/部署）

### P2-1 feature 边界漂移（11 处）

`admin/routes`、`projects/service`、`stats/routes`、`scans/queue`、`report/service` 直引 `../x/storage.js` 内部文件，绕过我们自定（对齐 VH dev-guide）的「跨 feature 只走 index.ts」规则。各 feature 的 index.ts 已导出 `* as xStorage`，**纯机械修复**（改 import 路径）。重要性：归并 VulnHunter 时它的边界 lint 会拦，现在改成本一刻钟，那时改成本翻倍。

### P2-2 shared/index 再导出 crypto-admin —— 浏览器 bundle 陷阱

`shared/src/index.ts` `export * from "./crypto-admin.js"`（引 `node:crypto`）。web 当前全部 `import type`（构建安全，已核实），但**任何一个未来的运行时值导入**都会把 `node:crypto` 拉进前端 bundle 直接炸构建。修复：`crypto-admin` 拆独立入口（package.json `exports` 加 `./crypto`），index 不再导出。

### P2-3 部署与配置缺口

| 项 | 现状 | 处置 |
|---|---|---|
| **CORS** | `origin: (origin) => origin || "*"` + `credentials: true`，反射任意来源 | 前后端分离部署**前**必须改白名单（env `ALLOWED_ORIGINS`）。当前无 cookie 会话风险尚可，但分离后是硬阻塞 |
| **Dockerfile** | 不存在（deploy/ 只有 compose + migrations） | PM 已列 todo，部署阻塞项 |
| `SCAN_CONCURRENCY` | 默认 1 | fish 要默认 4（稳定性套件 task-b2ccfc69 里一起改） |
| `ADMIN_PUBLIC_KEY` | 仅 `production` fail-fast | 建议 `mock=false` 即必填，否则 staging 空 key 在 sync 时才炸 |
| 死代码 | auth/me/disclosure stub 路由、`shared/api/auth.ts`、web client 的 MeResponse/Disclose* 类型 | owner 移除的收尾，一次性删 |
| `findings.title` 冗余列 | 与 `disclosed_title` 双写（migration 002 设计是 drop） | 下次 migration 清理，读取方统一走 `disclosed_title` |

## 四、P3 观察项（不阻塞）

1. **syncFindings N+1 拉取**：scanning 阶段每 30s 对每条 finding 拉一次 detail 并重新加密 upsert（49 条 = 每轮 50 次 VH 调用）。so_far 其实只需要 `listFindings` 计数 —— **建议 scanning 阶段只做 list+count，detail/encrypt/upsert 只在 completed 做一次**。省 ~90% 调用、消除重复加密，改 P1-2 时顺手做
2. **dispatch 瞬时错误直接 failed**：VH 重启/网络抖动导致 create 失败 → 立即 failed 需人工。建议 dispatch 侧加 2 次短退避重试再标 failed（与稳定性套件的 poll 宽限同思路）
3. **nonce 先消费后执行**：失败请求会烧 nonce（CLI 重试自动换新签名，可接受），已在设计语义内，不动
4. **info 级密文无读取路径**：`listEncryptedPackage` 过滤四档，info 永不导出 —— 与「info 不展示」一致，但确认是有意为之（这些密文将永久沉睡）
5. **git 单 commit**：开源首发无妨，后续保持增量提交纪律
6. **migration 纪律**：crypto 列是揉进 001_initial 的（原型期允许）。**从现在起库里有真实数据（lodash 49 条），schema 变更必须走增量 migration**，禁止再改 001

## 五、建议行动顺序

| 序 | 项 | 量级 |
|---|---|---|
| 1 | P1-1 聚合限定 latest completed job + P1-2 事务化/防重入（含 P3-1 so_far 简化，同改一个函数） | ~半天 |
| 2 | P2-3 CORS 白名单 + Dockerfile（部署阻塞） | ~半天 |
| 3 | P2-1 边界 import 机械修复 + P2-2 shared 入口拆分 + 死代码清理 | ~1-2h |
| 4 | 稳定性套件（task-b2ccfc69，已在途：failed 宽限、并发默认 4、动态配置、退避） | 已派 |

P1 两项建议插在稳定性套件之前或合并实施 —— 它们改的是同一个 queue.ts，避免冲突。
