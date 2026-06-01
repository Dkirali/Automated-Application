export type ApplyState =
  | "idle"
  | "starting"
  | "opening"
  | "easy_apply_click"
  | "filling"
  | "submitting"
  | "awaiting_user"
  | "applied"
  | "failed";

export interface ApplyStatus {
  state: ApplyState;
  message: string;
  startedAt: number;
  updatedAt: number;
  error?: string;
}

const TERMINAL: ReadonlyArray<ApplyState> = ["applied", "failed"];

// In-memory per-process tracker. Fine for the single-process dev server;
// would need DB or Redis for multi-process production.
const store = new Map<number, ApplyStatus>();

export function setStatus(
  appId: number,
  state: ApplyState,
  message: string,
  error?: string
): void {
  const prev = store.get(appId);
  const now = Date.now();
  store.set(appId, {
    state,
    message,
    startedAt: prev?.startedAt ?? now,
    updatedAt: now,
    error,
  });
}

export function getStatus(appId: number): ApplyStatus | null {
  return store.get(appId) ?? null;
}

export function clearStatus(appId: number): void {
  store.delete(appId);
}

export function isTerminal(state: ApplyState): boolean {
  return TERMINAL.includes(state);
}

export function isInFlight(appId: number): boolean {
  const s = store.get(appId);
  return !!s && !isTerminal(s.state);
}
