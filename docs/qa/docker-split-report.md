# Docker 拆分切换前验收（task-63d1ccf8）

> QA：qa ｜ 2026-08-03  
> 旁路栈：**本机** `COMPOSE_PROJECT_NAME=ovsplitqa` · **127.0.0.1:23101**（web→api→postgres）  
> 说明：VulnAgent `:23101` 在本 QA 主机不可达，按同款 `compose.prod.yml` + `openvuln:api`/`openvuln:web` 镜像本地复现验收  
> **生产流量未切**（clouditera / :7860 allinone 仍健康）

## 结论

**✅ 拓扑与迁移路径通过，具备切换条件**（在 pm 窗口切 nginx 前）

| # | 验收标准 | 结果 |
|---|---|---|
| 1 | compose 三服务：web / api / postgres，**无 MinIO** | ✅ 仅 3 容器 |
| 2 | web 唯一宿主端口；api/pg **不**映射宿主 | ✅ `23101→web:80`；api `7860/tcp` 仅内网 |
| 3 | `/health` + SPA + `/api/*` 同源反代 | ✅ 200；SPA `index-*.js` 200；stats/projects 经 nginx |
| 4 | boot migrations | ✅ api 日志 001–007 applied |
| 5 | 数据迁移：pg_dump → 新 PG → redis **22** findings | ✅ suricata 49 + redis 22 + artifacts 316 |
| 6 | 独立重启 api/web/pg 后数据仍在 | ✅ api/web/pg 各 restart 后 redis sum=22 |
| 7 | api 重启后进程恢复（poller 启动日志） | ✅ `Scan dispatcher + poller started`；completed 数据可读 |
| 8 | 生产未动 | ✅ clouditera `/health` 200；本地 allinone :7860 仍 up |
| 9 | 文档含 split + migrate runbook | ✅ `docs/deployment-public.md` § Prefer compose.prod.yml |

---

## 拓扑实测

```
127.0.0.1:23101 → ovsplitqa-web (nginx)
                    ├ /health  → api:7860
                    ├ /api/    → api:7860
                    └ /        → SPA
                  ovsplitqa-api (node, 内网)
                  ovsplitqa-pg  (postgres:16, volume)
```

- 日志：`vhAuth: token`（无 mock）  
- `No SPA public/ directory` 于 **api** 容器 = API-only 镜像预期；SPA 只在 web ✅  

---

## 数据迁移（模拟 runbook）

```
pg_dump allinone → psql ovsplitqa-pg
→ projects: OISF/suricata (49) + redis/redis (22)
→ finding_artifacts: 316
→ GET /api/projects/redis/redis severity c3/h4/m14/l1
```

---

## 未在本环境完整覆盖 / 观察

| ID | 说明 | 严重度 |
|---|---|---|
| OBS-SPL-1 | **路 B import** 在 split api 容器内拉 GitHub meta **TLS 失败**（`fetch failed`）。属容器出网/GitHub 网络，非 compose 拓扑错误。切换前在 VulnAgent 上对 import 再冒一次，或 import 支持跳过 live GitHub meta。 | 中（功能路径） |
| OBS-SPL-2 | 本机 dump 恢复后，已披露条下载仍为 **markdown**（`report` 字段、无 `report_yaml`）—— 与 **dump 源 allinone 数据/列** 及镜像版本对齐有关，**不是** nginx 反代丢 body。切换时应用 **与现网同版本的 api 镜像** + **现网 pg_dump**，并在 VulnAgent 旁路复测 raw yaml 下载。 | 中（版本对齐） |
| OBS-SPL-3 | 无真实 scanning 任务验证「api 重启后续跑 VH poll」；仅验证 poller 进程拉起 + PG 状态可读。 | 低 |
| OBS-SPL-4 | 文档前半仍描述 allinone/MinIO 历史拓扑；文末已写 Prefer compose — 建议切换前把 public doc 主路径改成 split，避免运维看错。 | 低 |

---

## 切换前检查清单（给 pm/fish）

1. VulnAgent 旁路 `:23101` 用**现网 dump + 现网同 tag 镜像**再确认 redis 22 + 任一披露 raw yaml  
2. nginx `proxy_pass` → split web；保留 allinone 7 天  
3. 切后冒烟：health、redis、提交预检、admin fetch-package  

---

## 签字

**task-63d1ccf8 旁路拓扑：✅ QA 通过（可约切换窗口）**  

### OBS 关项（2026-08-03 VulnAgent 复验）
见 `docs/qa/docker-split-obs-closeout.md`：
- OBS-SPL-1 ✅ api 容器 GitHub/codeload 200  
- OBS-SPL-2 ✅ 默认 md / `?format=yaml` / zip 经 web 反代均 200  
- OBS-SPL-5 **撤回**：默认 markdown = fish No.589 定稿，非缺陷  
