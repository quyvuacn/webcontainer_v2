import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { npmCi } from "./ci";

describe("npmCi", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const fakePkg = (name: string, version: string) => ({
          name,
          version,
          main: "index.js",
        });
        if (url.includes("/pkg@"))
          return Promise.resolve({
            ok: true,
            arrayBuffer: () =>
              Promise.resolve(
                new TextEncoder().encode(
                  JSON.stringify(fakePkg("pkg", "1.0.0")),
                ).buffer,
              ),
          });
        return Promise.resolve({ ok: false });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when no lockfile", async () => {
    const vfsRead = vi.fn(() => null);
    await expect(npmCi(vfsRead, vi.fn(), vi.fn(), vi.fn())).rejects.toThrow(
      "Missing package-lock.json",
    );
  });

  it("throws when no package.json", async () => {
    const vfsRead = vi.fn((path: string) => {
      if (path === "project/package-lock.json")
        return new TextEncoder().encode('{"packages":{}}');
      return null;
    });
    await expect(npmCi(vfsRead, vi.fn(), vi.fn(), vi.fn())).rejects.toThrow(
      "No package.json",
    );
  });

  it("install stubs from lockfile", async () => {
    const written: Record<string, unknown> = {};
    const vfsRead = vi.fn((path: string) => {
      if (path === "project/package.json")
        return new TextEncoder().encode(
          JSON.stringify({ dependencies: { pkg: "^1.0.0" } }),
        );
      if (path === "project/package-lock.json")
        return new TextEncoder().encode(
          JSON.stringify({
            packages: { "node_modules/pkg": { version: "1.0.0" } },
          }),
        );
      return null;
    });
    const vfsWrite = vi.fn((path: string, b: Uint8Array) => {
      written[path] = b;
    });
    const vfsAcquireLock = vi.fn(() => 1);
    const vfsReleaseLock = vi.fn();

    const r = await npmCi(
      vfsRead,
      vfsWrite,
      vfsAcquireLock,
      vfsReleaseLock,
      "project",
      { prefetch: false },
    );

    expect(r.added).toBe(1);
    expect(vfsWrite).toHaveBeenCalledWith(
      "project/node_modules/pkg/package.json",
      expect.anything(),
    );
  });
});
