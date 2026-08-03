// Deploy-time runtime config (not baked into the JS bundle).
// Override at deploy by rewriting this file on the static host.
//
// apiBase: "" = same-origin /api (openvuln.clouditera.com nginx)
//          "https://openvuln.clouditera.com" = cross-origin (e.g. HF Static)
// landing: "zai" = collaborator landing (default online)
//          "product" = full product deck (archive UI)
window.__OPENVULN__ = {
  apiBase: "",
  landing: "zai",
};
