-- 015: VH output_language + vuln_focus on scan_config
ALTER TABLE scan_config
  ADD COLUMN IF NOT EXISTS output_language text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS vuln_focus text;

-- Seed vuln_focus with priority ladder if empty; leave audit_focus as process/exclusion
UPDATE scan_config SET
  output_language = COALESCE(NULLIF(output_language, ''), 'en'),
  vuln_focus = COALESCE(
    NULLIF(vuln_focus, ''),
    $vf$审计优先级（按序消费时间，扫不完就放弃后面的）：
P0 外部输入可达的安全入口：
  - 网络服务入口：HTTP/RPC handler、文件上传、URL/回调拉取、WebSocket
  - 命令与代码执行：shell/subprocess/eval/exec/动态 import/模板渲染执行
  - 认证与授权：login/token/session/permission 校验逻辑
P1 危险数据流汇点：
  - 注入类：SQL/命令/路径拼接；反序列化（pickle/yaml.load 等可控输入）；XXE
  - SSRF：出向请求目标地址可被用户影响的路径
P2 资源与逻辑类（PoC 可验证才报）：
  - DoS（算法复杂度/资源耗尽）、条件竞争、逻辑绕过
P3 以上完成后才做：信息泄露、弱加密、配置缺陷$vf$
  ),
  audit_focus = COALESCE(
    NULLIF(audit_focus, ''),
    $af$排除清单（不审计、不出报告）：
- 测试与夹具：test/tests/spec/fixture/mock/__tests__/testdata
- 依赖与生成物：node_modules/vendor/third_party/dist/build/lock 文件
- 文档与静态配置：*.md / .github/ / CI 配置
- 数据文件：模型权重、数据集、二进制资源$af$
  ),
  updated_at = now()
WHERE id = 1;
