import { describe, it, expect, beforeEach } from "vitest";
import {
  setTimeout as wcSetTimeout,
  clearTimeout as wcClearTimeout,
  setInterval as wcSetInterval,
  clearInterval as wcClearInterval,
} from "./timers";

describe("timers active handles", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__wcActiveHandleCount;
  });

  it("setTimeout tăng count khi tạo", () => {
    wcSetTimeout(() => {}, 100);
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(
      1,
    );
  });

  it("clearTimeout trước khi fire thì giảm count", () => {
    const id = wcSetTimeout(() => {}, 100);
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(
      1,
    );
    wcClearTimeout(id);
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(
      0,
    );
  });

  it("setInterval tăng count, clearInterval giảm", () => {
    const id = wcSetInterval(() => {}, 100);
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(
      1,
    );
    wcClearInterval(id);
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(
      0,
    );
  });

  it("nhiều timer cộng dồn, clear từng cái giảm đúng", () => {
    const id1 = wcSetTimeout(() => {}, 200);
    const id2 = wcSetTimeout(() => {}, 300);
    const id3 = wcSetInterval(() => {}, 100);
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(
      3,
    );
    wcClearTimeout(id1);
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(
      2,
    );
    wcClearInterval(id3);
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(
      1,
    );
    wcClearTimeout(id2);
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(
      0,
    );
  });

  it("setTimeout fire thì giảm count", async () => {
    const p = new Promise<void>((resolve) => {
      wcSetTimeout(() => resolve(), 5);
    });
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(
      1,
    );
    await p;
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(
      0,
    );
  });
});
