import { describe, it, expect } from "vitest";
import { parseVersion, parseRange, satisfies } from "./semver";

describe("parseVersion", () => {
  it("parse 1.2.3", () => {
    expect(parseVersion("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      pre: "",
    });
  });
  it("parse 0.0.1", () => {
    expect(parseVersion("0.0.1")).toEqual({
      major: 0,
      minor: 0,
      patch: 1,
      pre: "",
    });
  });
  it("parse with pre", () => {
    expect(parseVersion("1.0.0-beta.1")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      pre: "beta.1",
    });
  });
  it("invalid returns null", () => {
    expect(parseVersion("abc")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
  });
});

describe("parseRange", () => {
  it("any", () => {
    expect(parseRange("*")).toEqual({ type: "any" });
    expect(parseRange("")).toEqual({ type: "any" });
  });
  it("exact", () => {
    expect(parseRange("1.2.3").type).toBe("exact");
    expect(parseRange("1.2.3").v!.major).toBe(1);
  });
  it("caret", () => {
    expect(parseRange("^1.2.3").type).toBe("caret");
  });
  it("tilde", () => {
    expect(parseRange("~1.2.3").type).toBe("tilde");
  });
});

describe("satisfies", () => {
  it("any always true", () => {
    expect(satisfies("1.0.0", { type: "any" })).toBe(true);
    expect(satisfies("9.9.9", { type: "any" })).toBe(true);
  });
  it("exact", () => {
    expect(satisfies("1.2.3", parseRange("1.2.3"))).toBe(true);
    expect(satisfies("1.2.4", parseRange("1.2.3"))).toBe(false);
  });
  it("caret", () => {
    expect(satisfies("1.2.3", parseRange("^1.2.0"))).toBe(true);
    expect(satisfies("1.3.0", parseRange("^1.2.0"))).toBe(true);
    expect(satisfies("2.0.0", parseRange("^1.2.0"))).toBe(false);
    expect(satisfies("1.1.9", parseRange("^1.2.0"))).toBe(false);
  });
  it("tilde", () => {
    expect(satisfies("1.2.3", parseRange("~1.2.0"))).toBe(true);
    expect(satisfies("1.2.9", parseRange("~1.2.0"))).toBe(true);
    expect(satisfies("1.3.0", parseRange("~1.2.0"))).toBe(false);
  });
  it("gte", () => {
    expect(satisfies("2.0.0", parseRange(">=1.0.0"))).toBe(true);
    expect(satisfies("1.0.0", parseRange(">=1.0.0"))).toBe(true);
    expect(satisfies("0.9.0", parseRange(">=1.0.0"))).toBe(false);
  });
});
