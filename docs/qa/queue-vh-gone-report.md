# 队列同步（VH 取消/删除）现网回归 — task-0fb73003

> QA：qa ｜ 2026-08-03  
> 环境：**https://openvuln.clouditera.com**（现网 allinone）  
> 依据：fish 定稿 — cancel=OV 不改；delete=硬删；不可达不动

## 结论

**✅ 通过（轻量现网回归）**

| # | 验收项 | 结果 |
|---|---|---|
| 1 | vllm / sglang 前台消失 | ✅ 列表无此二项目；直访 `.../vllm-project/vllm`、`.../sgl-project/sglang` → **404** `resource:project` |
| 2 | 死槽释放后 GLM 进入扫描 | ✅ **GLM-4、GLM-4.5 = scanning**；`scan_in_progress_count=2` |
| 3 | redis 无回归 | ✅ completed · c3/h4/m14/l1 · sum=22 · 无 enc 泄露 |
| 4 | 公众红线 | ✅ 项目详情无 `enc_payload`/OVENC1 |
| 5 | 历史 cancelled 遗留 | ⚠️ `huangruiteng/loopx` 仍 `failed`/`vh_state:cancelled`（**旧逻辑**遗留，**不占并发**）— OBS-Q1 |

未在本轮重做：cancel 保持 scanning 的 mock 单测（developer 已报绿）；VH 宕机误删（需故障注入，代码路径有结构化 `ERR_TASK_NOT_FOUND` 闸）。

---

## 现网队列快照（API）

| full_name | latest_scan.state | so_far | 备注 |
|---|---|---:|---|
| zai-org/GLM-4 | **scanning** | 0 | 正常占用槽 |
| zai-org/GLM-4.5 | **scanning** | 0 | 正常占用槽 |
| zai-org/GLM-5 | **failed** | 0 | 见 OBS-Q2（非 vllm 类死槽） |
| redis/redis | completed | 22 | 展品完好 |
| huangruiteng/loopx 等 | failed | 0 | 历史；FE→Waiting |

**已删除（验收目标）**：`vllm-project/vllm`、`sgl-project/sglang` — 列表与直链均无。

stats：`project_count=8` · `finding_total=22` · `scan_in_progress=2` · `scan_failed=5` · `scan_completed=1`

---

## 观察

| ID | 说明 |
|---|---|
| OBS-Q1 | `loopx` 等旧 `failed(vh_state:cancelled)` 行仍在；符合「上线前 cancelled→failed」历史，不占槽。可选 admin 清理，非阻断。 |
| OBS-Q2 | developer 上线时日志为 GLM-4/5 scanning；回归时 **GLM-5=failed**。需区分：VH 侧真实失败 vs 误判 gone。无 admin token 未读 `fail_reason`；建议 pm/dev 查 admin queue 一行 reason。**若 reason 为 vh_task_gone 且 VH 任务仍在，则是误删路径 bug；若 VH 已失败/取消后另有逻辑，另论。** |
| OBS-Q3 | 本环境 `dev-admin-token` 对 clouditera **401**，admin finalize/queue 未测。 |
| OBS-Q4 | 本地 :7860 仍是旧演示库（suricata+redis），与 clouditera 现网不是同一实例。 |

---

## 签字

**task-0fb73003：✅ QA 通过（现网主路径）**  
建议：抽查 GLM-5 的 `fail_reason_internal` 关闭 OBS-Q2。
