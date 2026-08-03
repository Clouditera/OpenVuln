# 生产回归：Docker 拆分切换 + 无扫描价值展示

> QA：qa ｜ 2026-08-03  
> 环境：https://openvuln.clouditera.com → nginx → **127.0.0.1:23101**（ovsplit-web/api/pg）  
> 任务：task-63d1ccf8 切流量 + task-76320c4b 无扫描价值  

## 结论

| 项 | 结果 |
|---|---|
| **拆分已切生产** | ✅ nginx `proxy_pass` → **23101**；all-in-one `openvuln-api` **Exited（未删）** |
| SPA + health + API | ✅ 200 |
| redis 22 findings | ✅ completed · c3/h4/m14/l1 · 无密文泄露 |
| **GLM-4 扫描续跑** | ✅ `scanning` · `findings_so_far=11`（切后仍 scanning，poller 接上） |
| **GLM-4.5 / GLM-5 无价值** | ✅ **`completed` + counts 全 0**（非 failed） |
| 其它失败未误伤 | ✅ loopx/linux/Hello-World/vercel/ai 仍 **failed** |
| admin report-package | ✅ 22 items + 316 artifacts 全 OVENC1（经 split 栈） |
| 公众红线 | ✅ |

**双任务生产回归：✅ QA 通过**

---

## 1. 切换拓扑

```
Browser → nginx openvuln.clouditera.com
       → 127.0.0.1:23101 ovsplit-web
       → ovsplit-api:7860
       → ovsplit-pg
回滚：nginx → 23100 + docker start openvuln-api
```

实测：`proxy_pass http://127.0.0.1:23101`；`openvuln-api Exited`。

---

## 2. 无扫描价值（task-76320c4b）

| 项目 | state | severity sum | 期望 |
|---|---|---:|---|
| zai-org/GLM-5 | **completed** | **0** | Scanned + 0 ✅ |
| zai-org/GLM-4.5 | **completed** | **0** | Scanned + 0 ✅ |
| zai-org/GLM-4 | scanning | 0（so_far=11 进行中） | 正常扫 ✅ |
| huangruiteng/loopx 等 | failed | 0 | 非「源码不完整」→ 仍 failed ✅ |

stats：`scan_completed_count=3`（redis + GLM-4.5 + GLM-5）、`scan_in_progress=1`、`scan_failed=4`。

---

## 3. 数据与加密

- redis：22 findings 完好  
- admin `report-package`：22 + 316 artifacts，全 `OVENC1.*`  
- 本环境无 prod 配对私钥，**未**做新 disclose E2E；下载三种格式在切前旁路已验，package 路径切后仍通  

---

## 观察

| ID | 说明 |
|---|---|
| OBS-CUT-1 | GLM-4 `so_far` 在 ~40s 窗口未上涨（仍 11），任务仍 scanning — 不表示 poller 挂死，可能 VH 侧暂时无新 index；建议继续观察是否 completed |
| OBS-CUT-2 | 披露下载完整签名链路需 prod `admin.pem`；本次以 package 密文完整性代替 |

---

## 签字

- **task-63d1ccf8 生产切换**：**✅**  
- **task-76320c4b 无扫描价值展示**：**✅**  
