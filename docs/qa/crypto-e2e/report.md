# octocat/Hello-World — decrypted findings

## [critical] Remote code execution via deserialization

- key: `mock-crit-289ea65c`
- id: `8e8238d8-07ec-4616-a31d-46d7b9e0c70f`
- cwe: CWE-502
- file: src/serde/handler.ts
- state: owner_only

```json
{
  "key": "mock-crit-289ea65c",
  "severity": "high",
  "title": "Remote code execution via deserialization",
  "cwe": "CWE-502",
  "primary_file": "src/serde/handler.ts",
  "item_type": "finding",
  "poc_status": "confirmed",
  "cvss_score": 9.8,
  "cvss_vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
  "description": "Mock finding detail for Remote code execution via deserialization.",
  "code_snippet": "// vulnerable code at src/serde/handler.ts\nfunction handle(input) {\n  // ...\n}"
}
```

## [high] SQL Injection in query builder

- key: `mock-sqli-289ea65c`
- id: `0a7b001f-73d4-472c-babe-d08469df1a3b`
- cwe: CWE-89
- file: src/db/query.ts
- state: owner_only

```json
{
  "key": "mock-sqli-289ea65c",
  "severity": "high",
  "title": "SQL Injection in query builder",
  "cwe": "CWE-89",
  "primary_file": "src/db/query.ts",
  "item_type": "finding",
  "poc_status": "confirmed",
  "cvss_score": 8.1,
  "cvss_vector": "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N",
  "description": "Mock finding detail for SQL Injection in query builder.",
  "code_snippet": "// vulnerable code at src/db/query.ts\nfunction handle(input) {\n  // ...\n}"
}
```

## [medium] Reflected XSS in search parameter

- key: `mock-xss-289ea65c`
- id: `7b046713-2092-4093-a827-8b8eb8c9b3fd`
- cwe: CWE-79
- file: src/web/search.tsx
- state: owner_only

```json
{
  "key": "mock-xss-289ea65c",
  "severity": "medium",
  "title": "Reflected XSS in search parameter",
  "cwe": "CWE-79",
  "primary_file": "src/web/search.tsx",
  "item_type": "finding",
  "poc_status": "not-needed",
  "cvss_score": 5.4,
  "cvss_vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N",
  "description": "Mock finding detail for Reflected XSS in search parameter.",
  "code_snippet": "// vulnerable code at src/web/search.tsx\nfunction handle(input) {\n  // ...\n}"
}
```
