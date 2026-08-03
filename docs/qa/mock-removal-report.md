# 移除 mock 模式验收报告（task-cd1341b4）

> QA：qa ｜ 2026-08-03  
> 依据：产品代码无 mock 运行时；测试 fixture 可保留；全量测试绿；现网无回归

## 结论

**✅ 通过**

| # | 验收项 | 结果 |
|---|---|---|
| 1 | 产品代码无 `VULNHUNTER_MOCK` / Mock client / mock-client 模块 | ✅ `packages/**/src` 排除 test/fixtures 后 **grep 零命中** |
| 2 | VH 运行时仅 token / cookie | ✅ `initVulnHunterClient` 二分支；无 mock 文件于 `features/vulnhunter/` |
| 3 | 测试 fixture 隔离 | ✅ 仅 `packages/service/src/test/fixtures/mock-vh-client.ts` + setup `setVulnHunterClient` |
| 4 | 全量 vitest | ✅ **37/37**（10 files） |
| 5 | `.env.example` / `deploy/*` 无 MOCK 配置 | ✅ |
| 6 | 演示脚本 | ✅ `run-demo` 已 archive；默认 `run-real-vh.sh` |
| 7 | 现网冒烟 | ✅ clouditera health；redis completed 22；GLM-4 scanning；红线无 enc |

---

## 产品路径核对

```
features/vulnhunter/
  client.ts | cookie-client.ts | token-client.ts | index.ts
  （无 mock-client.ts）
```

- `setVulnHunterClient` 保留为 **Test-only DI**（注释标明），不构成 env 开关式 mock 模式 ✅ 可接受
- 历史 QA 报告文档中的 `VULNHUNTER_MOCK=true` 字样属**过往证据**，非产品代码

---

## 现网冒烟（https://openvuln.clouditera.com）

| 检查 | 结果 |
|---|---|
| `/health` | 200 |
| redis/redis | completed · c3/h4/m14/l1 · 无 OVENC1 泄露 |
| GLM-4 | scanning |
| stats | project_count=8 · finding_total=22 · in_progress≥1 |

未做：新提交真扫全链路（成本高；现网已在扫 GLM，证明 token 真模式存活）。

---

## 签字

**task-cd1341b4：✅ QA 通过** — 可上线/保持现网（若尚未热更则部署后无行为 diff 预期，因现网本就非 mock）。
