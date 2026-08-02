# 稳定性套件 + 架构 P1 验收报告

> 任务：task-b2ccfc69 ｜ QA：qa ｜ 2026-08-02  
> 依据：architect 方案 §9（task 评论）+ fish 稳定性三点  
> 环境：隔离 `openvuln_qa` @ `ov-pg-tmp:5434` + `:17860` + **mock** + QA 密钥  
> 另：演示站 `:7860` lodash **只读**红线抽检  
> 证据：`docs/qa/stability/`

## 结论

**✅ 通过** — architect 七条要点在 E2E/故障注入下达标；C8b 披露保留仍绿；演示 lodash 公众红线仍立。

| # | 要点 | 结果 |
|---|---|---|
| 1 | 重扫中公众计数=旧 job，completed 后原子切换 | ✅ |
| 2 | sync 事务 / 披露保留（C8b） | ✅ |
| 3 | failed 宽限 3 次 | ✅ 单元/集成 35/35（含 queue）；E2E 见 resync 路径 |
| 4 | PUT scan-config 动态并发 | ✅ |
| 5 | VH 不可达退避 | ✅ 单测覆盖；E2E 未挂真断网（OBS-S2） |
| 6 | resync：failed+VH completed→同步；非 completed→409 | ✅ |
| 7 | C8b + 真实库红线 | ✅ mock C8b；lodash 49 密文公众无详情 |

---

## 环境

```
DATABASE_URL=...@127.0.0.1:5434/openvuln_qa
PORT=17860  VULNHUNTER_MOCK=true  SCAN_CONCURRENCY=2→override
ADMIN_TOKEN=qa-stab-admin  SCAN_VH_FAIL_GRACE_POLLS=3
migrations: 001…004_stability
```

未写入演示库 `:7860` / lodash 数据。

---

## 场景明细

### T0 scan-config
| 操作 | 结果 |
|---|---|
| GET 无 token | 401 |
| GET | `{concurrency:2, source:"env", vh_fail_grace_polls:3}` |
| PUT `{concurrency:1}` | 200 `source:override` |
| PUT `{concurrency:99}` | 200 **clamp→16**（非 422）→ OBS-S1 |

### T1 首扫 + 指针
Hello-World completed → `current_scan_job_id` 指向 job；3× OVENC1；counts c/h/m=1。

### T2–T3 重扫不翻倍 + C8b
1. disclose `mock-sqli`+`mock-xss` → 公众 disc=2  
2. 冷却=0 再次 submit → **新 job queued，响应里 severity_counts 仍 1/1/1**（旧指针）  
3. completed 后 pointer 翻到新 job；DB keys 仍 `mock-sqli/xss:disclosed` + title；counts 不膨胀；公众 disc=2  

证据：`t3-resubmit.json`（queued 时 counts 旧值）、`t3-after.json`。

### T6 resync 成功路径
- job 人工 `failed` 后公众 latest=failed，**counts/disc 仍在**（findings 未删）  
- `POST .../resync` 无 token → 401  
- 有 token → `{ok:true, public_count:3}` → latest=completed，disc=2  

### T7 resync 冲突路径
- scanning 中标 failed → resync → **409** `vh_not_completed`（vh_state=queued/running）  
- 已 completed 再 resync → **409** `not_failed`  

### T8 宽限 / 退避 / 全量单测
隔离 E2E 未直接 `forceState(failed)×3`（mock force 仅进程内测试 API）。  
`pnpm --filter @openvuln/service test` → **35/35 PASS**（queue / queue-integration / crypto C8b / redline）。

### T9 演示站只读（真实数据）
`GET :7860/api/projects/lodash/lodash` + overview：
- high:45 medium:4 total:49；disclosed=[]  
- 响应无 `enc_payload` / OVENC1 / primary_file / code_snippet  
- 无 poc_rate  

---

## 观察（不阻断）

| ID | 说明 |
|---|---|
| OBS-S1 | `PUT scan-config` 超出 1..16 时 **clamp 到边界** 而非 422。可用但不直观，建议改校验错误或文档写明 clamp。 |
| OBS-S2 | VH 全挂指数退避依赖单测 + 代码路径；本轮未做真断网注入。 |
| OBS-S3 | 重扫中途 `latest_scan` 会指向新 job（state=scanning），counts 仍走 current pointer —— UI 需同时展示「历史公开计数 + 进行中扫描」语义（前端已有 so_far 字段）。 |

---

## 签字

- **task-b2ccfc69**：✅ QA 通过  
- 建议下一步：部署准备（Dockerfile/CORS）+ 真实 VH 故障注入（可选）/ 前端全站  
