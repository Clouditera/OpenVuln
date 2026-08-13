/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin, no trailing slash. Empty/unset = same-origin `/api`. */
  readonly VITE_API_BASE_URL?: string;
  /** `product` = full product deck; default/other = collaborator Z.ai landing. */
  readonly VITE_LANDING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
