/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional dev-only API origin. Production uses public/config.js. */
  readonly VITE_API_BASE_URL?: string;
  /** Optional dev-only landing override. Production uses public/config.js. */
  readonly VITE_LANDING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
