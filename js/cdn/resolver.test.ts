import { describe, it, expect } from "vitest";
import { resolveExports } from "./resolver";

describe("resolveExports", () => {
  it("string", () => {
    expect(resolveExports("./index.js", ".")).toBe("./index.js");
    expect(resolveExports("./x", "foo")).toBeNull();
  });
  it("map exact", () => {
    const ex = { ".": "./index.js", "./utils": "./utils.js" };
    expect(resolveExports(ex, ".")).toBe("./index.js");
    expect(resolveExports(ex, "utils")).toBe("./utils.js");
  });
  it("conditions", () => {
    const ex = { ".": { import: "./esm.js", default: "./cjs.js" } };
    expect(resolveExports(ex, ".")).toBe("./esm.js");
  });
  it("pattern", () => {
    const ex = { "./features/*": "./features/*.js" };
    const r = resolveExports(ex, "features/auth");
    expect(r).toContain("auth");
    expect(r).toContain(".js");
  });
  it("array fallback", () => {
    const ex = { ".": ["./a.js", "./b.js"] };
    expect(resolveExports(ex, ".")).toBe("./a.js");
  });
});
