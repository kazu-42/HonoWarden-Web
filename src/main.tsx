import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { MemorySessionStore } from "./session/memory-session-store";
import "./styles.css";

const session = new MemorySessionStore();

if (
  (import.meta.env.DEV || import.meta.env.MODE === "e2e") &&
  ["127.0.0.1", "localhost"].includes(location.hostname) &&
  location.pathname === "/_local/authenticated-shell"
) {
  const now = Date.now();
  session.open({
    accessToken: `local.${crypto.randomUUID()}`,
    refreshToken: `local.${crypto.randomUUID()}`,
    expiresAt: now + 3_600_000,
    accountLabel: "synthetic@example.test",
  });
}

function Root() {
  const snapshot = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.snapshot(),
    () => session.snapshot(),
  );

  return <App session={snapshot} onLock={() => session.lock()} />;
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Application root is missing.");
}

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
