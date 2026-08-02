# 部署准备验收报告（CORS + Dockerfile + 文档）

> 任务：task-f744b528 ｜ QA：qa ｜ 2026-08-02  
> 证据：`docs/qa/deploy/`  
> 隔离：本地进程 :17861 + 容器 :17870 → PG `openvuln_qa_*` @ :5434（**未动**演示 :7860）

## 结论

**✅ 通过** — CORS 白名单行为正确；Docker 多阶段镜像可 build/run；启动自动 migration；SPA + API 200；文档含 HF env/密钥卫生清单。

---

## 1. CORS 白名单

| 配置 | Origin | `Access-Control-Allow-Origin` |
|---|---|---|
| 空（未设 env） | `https://evil.example` | **无**（不反射） |
| 空 | `http://localhost:5173` | **无** |
| `localhost:5173,https://openvuln-demo.hf.space` | `http://localhost:5173` | ✅ 回显该 Origin |
| 同上 | `https://openvuln-demo.hf.space` | ✅ |
| 同上 | `https://evil.example` | **无** |
| 同上 | OPTIONS preflight `localhost:5173` | ✅ 204 + allow-origin |

容器内同样：`CORS_ALLOWED_ORIGINS=http://localhost:5173` → 白名单命中有 ACAO，evil 无。

---

## 2. Dockerfile 镜像

```
docker build -f deploy/Dockerfile -t openvuln:qa-local .   # exit 0
docker run … -p 17870:7860 -e DATABASE_URL=…@host.docker.internal:5434/openvuln_qa_docker …
```

| 检查 | 结果 |
|---|---|
| build | ✅ |
| 日志 migrations 001–004 | ✅ 全部 applied |
| `GET /health` | ✅ 200 `{"ok":true,"service":"openvuln"}` |
| `GET /` SPA | ✅ 200，`<!doctype html>` + OpenVuln title |
| `GET /api/stats/overview` | ✅ 200 JSON |
| `POST /api/projects` mock | ✅ 201 queued |
| 镜像内无 `.env`/pem 拷入 | ✅ `.dockerignore` 含 `.env` `*.pem` `.data` |

---

## 3. 部署文档 `deploy/README.md`

含：HF Docker Space 拓扑、Secrets 表（`DATABASE_URL` / `VULNHUNTER_*` / `ADMIN_TOKEN` / `ADMIN_PUBLIC_KEY` / `CORS_ALLOWED_ORIGINS` / 扫描参数）、**私钥永不进容器**、token 轮换、Static Space 分体部署、本地 smoke 命令。✅

---

## 观察（不阻断）

| ID | 说明 |
|---|---|
| OBS-D1 | 空 CORS 时响应仍带 `access-control-allow-credentials: true` 但无 ACAO —— 浏览器跨站仍拒；可接受。 |
| OBS-D2 | README 写 compose 默认可选 service block；当前 compose 以 Postgres 为主，与实测一致。 |
| OBS-D3 | 真 HF Space 上线（secrets 注入、外网 VH）本轮**未**做，属运维步骤。 |

---

## 签字

- **task-f744b528**：✅ QA 通过，可进入 HF 部署操作  
- 未覆盖：真实 HF 控制台创建 Space、Neon 连通、生产 token 注入（需 fish 侧）
