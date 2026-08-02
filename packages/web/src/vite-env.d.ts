/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin for split deploy (HF Static). Empty = same-origin. */
  readonly VITE_API_BASE_URL?: string;
  /** `zai` → Z.ai marketing landing on `/` (HF build). */
  readonly VITE_LANDING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
