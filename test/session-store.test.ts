import { describe, expect, it, vi } from "vitest";

import { MemorySessionStore } from "../src/session/memory-session-store";

describe("MemorySessionStore", () => {
  it("starts locked and returns no authorization value", () => {
    const session = new MemorySessionStore();

    expect(session.snapshot()).toEqual({ status: "locked" });
    expect(session.authorizationHeader()).toBeNull();
  });

  it("exposes only non-secret session metadata to UI subscribers", () => {
    const now = Date.parse("2026-07-17T12:00:00.000Z");
    const session = new MemorySessionStore(() => now);
    const listener = vi.fn();
    session.subscribe(listener);

    session.open({
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      expiresAt: now + 60_000,
      accountLabel: "synthetic@example.test",
    });

    expect(session.snapshot()).toEqual({
      status: "authenticated",
      accountLabel: "synthetic@example.test",
      expiresAt: now + 60_000,
    });
    expect(JSON.stringify(session.snapshot())).not.toContain("token");
    expect(session.authorizationHeader()).toBe("Bearer synthetic-access-token");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("clears secrets on lock and fails closed after expiry", () => {
    let now = Date.parse("2026-07-17T12:00:00.000Z");
    const session = new MemorySessionStore(() => now);

    session.open({
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      expiresAt: now + 1_000,
      accountLabel: "synthetic@example.test",
    });
    now += 1_001;

    expect(session.authorizationHeader()).toBeNull();
    expect(session.snapshot()).toEqual({ status: "locked" });

    session.open({
      accessToken: "new-synthetic-access-token",
      refreshToken: "new-synthetic-refresh-token",
      expiresAt: now + 1_000,
      accountLabel: "synthetic@example.test",
    });
    session.lock();

    expect(session.authorizationHeader()).toBeNull();
    expect(session.snapshot()).toEqual({ status: "locked" });
  });

  it("locks and notifies subscribers when an idle session expires", () => {
    let now = Date.parse("2026-07-17T12:00:00.000Z");
    let expire: (() => void) | undefined;
    const timerHandle = Symbol("expiry-timer");
    const schedule = vi.fn((callback: () => void, delayMs: number) => {
      expire = callback;
      expect(delayMs).toBe(1_000);
      return timerHandle;
    });
    const cancel = vi.fn();
    const session = new MemorySessionStore(() => now, schedule, cancel);
    const listener = vi.fn();
    session.subscribe(listener);

    session.open({
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      expiresAt: now + 1_000,
      accountLabel: "synthetic@example.test",
    });

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(session.snapshot().status).toBe("authenticated");

    now += 1_000;
    expire?.();

    expect(session.snapshot()).toEqual({ status: "locked" });
    expect(session.authorizationHeader()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("rejects blank or already-expired session material", () => {
    const now = Date.parse("2026-07-17T12:00:00.000Z");
    const session = new MemorySessionStore(() => now);

    expect(() =>
      session.open({
        accessToken: " ",
        refreshToken: "synthetic-refresh-token",
        expiresAt: now + 1_000,
        accountLabel: "synthetic@example.test",
      }),
    ).toThrow("Session material is invalid.");

    expect(() =>
      session.open({
        accessToken: "synthetic-access-token",
        refreshToken: "synthetic-refresh-token",
        expiresAt: now,
        accountLabel: "synthetic@example.test",
      }),
    ).toThrow("Session material is invalid.");
  });
});
