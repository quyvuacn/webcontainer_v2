import { addActiveHandle } from "./active-handles";

const nat = {
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  setInterval: globalThis.setInterval.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
};

const releases = new Map<ReturnType<typeof globalThis.setTimeout>, () => void>();

function releaseId(id: ReturnType<typeof globalThis.setTimeout>, clear: (i: unknown) => void) {
  const r = releases.get(id);
  if (r) {
    releases.delete(id);
    r();
    clear(id);
  }
}

export function setTimeout(
  cb: (...args: unknown[]) => void,
  ms?: number,
  ...args: unknown[]
): ReturnType<typeof globalThis.setTimeout> {
  const release = addActiveHandle();
  const id = nat.setTimeout(
    () => {
      releases.delete(id);
      release();
      (cb as (...a: unknown[]) => void)(...args);
    },
    ms,
    ...args
  ) as ReturnType<typeof globalThis.setTimeout>;
  releases.set(id, release);
  return id;
}

export function clearTimeout(id: ReturnType<typeof globalThis.setTimeout> | undefined): void {
  if (id != null) releaseId(id, nat.clearTimeout);
  nat.clearTimeout(id);
}

export function setInterval(
  cb: (...args: unknown[]) => void,
  ms?: number,
  ...args: unknown[]
): ReturnType<typeof globalThis.setInterval> {
  const release = addActiveHandle();
  const id = nat.setInterval(
    () => (cb as (...a: unknown[]) => void)(...args),
    ms,
    ...args
  ) as ReturnType<typeof globalThis.setInterval>;
  releases.set(id, release);
  return id;
}

export function clearInterval(id: ReturnType<typeof globalThis.setInterval> | undefined): void {
  if (id != null) releaseId(id, nat.clearInterval);
  nat.clearInterval(id);
}

export function setImmediate(cb: (...args: unknown[]) => void, ...args: unknown[]): ReturnType<typeof globalThis.setTimeout> {
  return setTimeout(cb, 0, ...args);
}

export function clearImmediate(id: ReturnType<typeof globalThis.setTimeout> | undefined): void {
  clearTimeout(id);
}

export function createTimersPolyfill() {
  return {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
  };
}
