export type LockedSessionSnapshot = Readonly<{
  status: "locked";
}>;

export type AuthenticatedSessionSnapshot = Readonly<{
  status: "authenticated";
  accountLabel: string;
  expiresAt: number;
}>;

export type SessionSnapshot =
  LockedSessionSnapshot | AuthenticatedSessionSnapshot;

type SessionMaterial = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountLabel: string;
};

type Listener = () => void;
type ScheduleExpiry = (callback: () => void, delayMs: number) => unknown;
type CancelExpiry = (handle: unknown) => void;

const MAX_TIMER_DELAY_MS = 2_147_483_647;

const LOCKED_SNAPSHOT: LockedSessionSnapshot = Object.freeze({
  status: "locked",
});

export class MemorySessionStore {
  readonly #now: () => number;
  readonly #scheduleExpiry: ScheduleExpiry;
  readonly #cancelExpiry: CancelExpiry;
  readonly #listeners = new Set<Listener>();
  #material: SessionMaterial | null = null;
  #snapshot: SessionSnapshot = LOCKED_SNAPSHOT;
  #expiryHandle: unknown | null = null;

  constructor(
    now: () => number = Date.now,
    scheduleExpiry: ScheduleExpiry = defaultScheduleExpiry,
    cancelExpiry: CancelExpiry = defaultCancelExpiry,
  ) {
    this.#now = now;
    this.#scheduleExpiry = scheduleExpiry;
    this.#cancelExpiry = cancelExpiry;
  }

  open(material: SessionMaterial): void {
    if (!isValidMaterial(material, this.#now())) {
      throw new Error("Session material is invalid.");
    }

    this.#cancelExpiryTimer();
    this.#material = {
      accessToken: material.accessToken.trim(),
      refreshToken: material.refreshToken.trim(),
      expiresAt: material.expiresAt,
      accountLabel: material.accountLabel.trim(),
    };
    this.#snapshot = Object.freeze({
      status: "authenticated",
      accountLabel: this.#material.accountLabel,
      expiresAt: this.#material.expiresAt,
    });
    this.#scheduleExpiryTimer();
    this.#emit();
  }

  lock(): void {
    if (!this.#material && this.#snapshot.status === "locked") {
      this.#cancelExpiryTimer();
      return;
    }

    this.#cancelExpiryTimer();
    this.#material = null;
    this.#snapshot = LOCKED_SNAPSHOT;
    this.#emit();
  }

  snapshot(): SessionSnapshot {
    return this.#snapshot;
  }

  authorizationHeader(): string | null {
    if (!this.#material) {
      return null;
    }
    if (this.#material.expiresAt <= this.#now()) {
      this.lock();
      return null;
    }
    return `Bearer ${this.#material.accessToken}`;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #emit(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }

  #scheduleExpiryTimer(): void {
    if (!this.#material) {
      return;
    }

    const delayMs = Math.min(
      Math.max(this.#material.expiresAt - this.#now(), 0),
      MAX_TIMER_DELAY_MS,
    );
    this.#expiryHandle = this.#scheduleExpiry(() => {
      this.#expiryHandle = null;
      if (!this.#material) {
        return;
      }
      if (this.#material.expiresAt <= this.#now()) {
        this.lock();
        return;
      }
      this.#scheduleExpiryTimer();
    }, delayMs);
  }

  #cancelExpiryTimer(): void {
    if (this.#expiryHandle === null) {
      return;
    }
    this.#cancelExpiry(this.#expiryHandle);
    this.#expiryHandle = null;
  }
}

function defaultScheduleExpiry(callback: () => void, delayMs: number): unknown {
  return globalThis.setTimeout(callback, delayMs);
}

function defaultCancelExpiry(handle: unknown): void {
  globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
}

function isValidMaterial(material: SessionMaterial, now: number): boolean {
  return (
    isBoundedNonBlank(material.accessToken, 32_768) &&
    isBoundedNonBlank(material.refreshToken, 32_768) &&
    Number.isFinite(material.expiresAt) &&
    material.expiresAt > now &&
    isBoundedNonBlank(material.accountLabel, 320)
  );
}

function isBoundedNonBlank(value: string, maximumLength: number): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength;
}
