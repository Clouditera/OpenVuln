/**
 * Popup OAuth callback: shown in the popup window after GitHub redirect.
 * Displays "Login successful, you can close this tab" and signals the opener.
 */
export function PopupCallbackPage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#000",
        color: "#f0f2f6",
        fontFamily: "system-ui, -apple-system, sans-serif",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>✅</div>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>
        Login successful
      </h1>
      <p style={{ color: "#acacb0", fontSize: "0.95rem" }}>
        You can close this tab and return to OpenVuln.
      </p>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            // Signal opener window to refresh login state
            if (window.opener) {
              window.opener.postMessage({ type: "ov-oauth-complete" }, "*");
            }
            // Auto-close after 2s if opener still open
            setTimeout(function() {
              try { window.close(); } catch(e) {}
            }, 2000);
          `,
        }}
      />
    </div>
  );
}
