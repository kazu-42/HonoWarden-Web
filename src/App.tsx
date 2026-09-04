import {
  ArchiveRestore,
  Heart,
  KeyRound,
  LockKeyhole,
  LogOut,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  Vault,
} from "lucide-react";
import { useId, useState } from "react";

import type { SessionSnapshot } from "./session/memory-session-store";

type AppProps = {
  session: SessionSnapshot;
  onLock: () => void;
};

type VaultView = "Vault" | "Favorites" | "Shared" | "Trash";

const NAVIGATION = [
  { label: "Vault", icon: Vault },
  { label: "Favorites", icon: Heart },
  { label: "Shared", icon: Users },
  { label: "Trash", icon: Trash2 },
] as const;

export function App({ session, onLock }: AppProps) {
  if (session.status === "locked") {
    return <LockedShell />;
  }

  return <AuthenticatedShell session={session} onLock={onLock} />;
}

function LockedShell() {
  return (
    <main className="locked-shell">
      <div className="locked-shell__brand" aria-hidden="true">
        <span className="brand-mark">H</span>
        <span>HonoWarden</span>
      </div>
      <section className="locked-panel" aria-labelledby="locked-title">
        <div className="locked-panel__icon" aria-hidden="true">
          <LockKeyhole size={28} strokeWidth={1.8} />
        </div>
        <p className="state-label">
          <span className="state-dot" /> Locked
        </p>
        <h1 id="locked-title">HonoWarden Web Vault</h1>
        <p className="locked-panel__message">Authentication required</p>
      </section>
      <p className="locked-shell__footer">End-to-end encrypted vault</p>
    </main>
  );
}

function AuthenticatedShell({
  session,
  onLock,
}: {
  session: Extract<SessionSnapshot, { status: "authenticated" }>;
  onLock: () => void;
}) {
  const [activeView, setActiveView] = useState<VaultView>("Vault");
  const [query, setQuery] = useState("");
  const searchId = useId();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="brand-mark" aria-hidden="true">
            H
          </span>
          <span className="topbar__wordmark">HonoWarden</span>
        </div>
        <div className="topbar__account">
          <div className="account-copy">
            <span className="account-copy__label">Session active</span>
            <span className="account-copy__identity">
              {session.accountLabel}
            </span>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Lock vault"
            title="Lock vault"
            onClick={onLock}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <nav className="vault-navigation" aria-label="Vault">
        <div className="vault-navigation__status">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>Protected session</span>
        </div>
        <div className="vault-navigation__items">
          {NAVIGATION.map(({ label, icon: Icon }) => (
            <button
              className="nav-button"
              data-active={activeView === label}
              type="button"
              key={label}
              onClick={() => setActiveView(label)}
              aria-current={activeView === label ? "page" : undefined}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>

      <main className="vault-main">
        <div className="vault-main__heading">
          <div>
            <p className="section-kicker">Personal vault</p>
            <h1>{activeView}</h1>
          </div>
          <span className="item-count">0 items</span>
        </div>

        <div className="vault-toolbar">
          <label className="search-field" htmlFor={searchId}>
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">Search vault</span>
            <input
              id={searchId}
              type="search"
              placeholder="Search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>

        <section className="empty-state" aria-live="polite">
          <div className="empty-state__icon" aria-hidden="true">
            {activeView === "Trash" ? (
              <ArchiveRestore size={30} />
            ) : (
              <KeyRound size={30} />
            )}
          </div>
          <h2>{emptyStateTitle(activeView, query)}</h2>
          <p>{emptyStateMessage(activeView, query)}</p>
        </section>
      </main>
    </div>
  );
}

function emptyStateTitle(view: VaultView, query: string): string {
  if (query.trim()) {
    return "No matching items";
  }
  if (view === "Favorites") {
    return "No favorites";
  }
  if (view === "Shared") {
    return "No shared items";
  }
  if (view === "Trash") {
    return "Trash is empty";
  }
  return "No vault items";
}

function emptyStateMessage(view: VaultView, query: string): string {
  if (query.trim()) {
    return "Try a different search.";
  }
  if (view === "Trash") {
    return "Deleted items will appear here.";
  }
  return "Synced items will appear here.";
}
