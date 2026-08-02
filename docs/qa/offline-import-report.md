# 路 B 离线导入验收报告（task-b671750d）

> QA：qa ｜ 2026-08-02  
> 环境：allinone `http://127.0.0.1:7860`  
> 素材：`~/dev/llm/VulnForge/.runs/redis-8.8.0-glm52`  
> 顺带：单条下载前端修复 + Details `report_yaml` 字段

## 结论

**✅ 通过**

| # | 项 | 结果 |
|---|---|---|
| 1 | 过滤口径 22 vuln / 32 risk skip | ✅ 与源 `finding_class` + decision 一致；reimport `imported:22 skipped:32` |
| 2 | reproduced → confirmed（可导入） | ✅ 源 22×reproduced 全部入库 |
| 3 | severity 映射 | ✅ public **c3 / h4 / m14 / l1** |
| 4 | report_yaml 22/22 + 与源文件 byte-equal | ✅ 抽检 `BUG-R35-C6-A3-H1` src=pkg=api=download |
| 5 | artifacts **316** 全 OVENC1 | ✅ package 含 enc；解密样本可读；错 AAD 失败 |
| 6 | 公众红线（未披露） | ✅ 无 enc/OVENC1/report_yaml/path |
| 7 | 幂等 re-import | ✅ counts 仍 22；pkg items 22 / arts 316 |
| 8 | 披露 + 单条 raw yaml 下载 | ✅ Details 有 yaml；download = API yaml = 源 |
| 9 | 单元测试 | ✅ **33/33** |

---

## redis/redis 公众数据

| 字段 | 值 |
|---|---|
| state | completed |
| commit_sha | `3acc0c49cf5ad2af9425d333e62728342dd6159b` |
| severity_counts | critical **3** · high **4** · medium **14** · low **1** |
| finding_total（平台含 suricata） | 71（49+22） |

### 源目录对账
- `findings/*`：`finding_class` vulnerability **22** / risk **32**
- `poc_status`：reproduced **22** / not-needed **32**（risk）
- import 输出：`imported:22 skipped:32` ✅

### 密文包
- items **22** · artifacts **316**（poc 120 + exp 196）
- 全部 `OVENC1.*`；CLI decrypt **22 findings + 316/316 artifacts**

### 披露链路（抽 1 条 critical）
- Details：`report_yaml` 以 `metadata:` 开头，真实中文标题
- `GET .../report/{key}` → `application/yaml` · `{key}.report.yaml` · **与源 yaml 一致**

---

## 顺带验证（fish 反馈项）

| 项 | 结果 |
|---|---|
| 前端下载不再 `?format=markdown` | ✅ bundle `index-BqV36JNV.js` 中 **0** 处 `format=markdown`；href 为 `/api/projects/.../report/{key}` |
| 单条 API 下载 | ✅ 5/5 suricata 全量披露条为 raw yaml 附件 |
| Details 有有效信息 | ✅ `disclosed_findings[]` 含 `report_yaml` + `summary` + 真标题（无 compat 占位） |
| suricata 标题 | ✅ 均为真实 lodash 漏洞标题 |

---

## 观察

| ID | 说明 |
|---|---|
| OBS-IMP-1 | re-import 会换新 `scan_job_id` 并重写 findings（幂等计数正确）；已披露需用**新 package** 再 disclose（旧 finding_id 失效） |
| OBS-IMP-2 | 平台 stats 跨项目聚合含 suricata+redis，符合 current pointer 设计 |

---

## 签字

**task-b671750d：✅ QA 通过**
