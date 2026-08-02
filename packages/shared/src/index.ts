// @openvuln/shared — cross-process contracts (types, constants). Zero runtime deps.

export * from "./domain.js";
export * from "./errors.js";
export * from "./api/index.js";

// crypto-admin is intentionally NOT re-exported here: it imports node:crypto
// and must stay out of the browser bundle path. Import "@openvuln/shared/crypto"
// from server-side code (service / admin-cli) only.
