import { describe, it, expect } from "vitest";
import {
  serializeRequest,
  deserializeRequest,
  serializeResponse,
  deserializeResponse,
} from "./http_serialize";

describe("serializeRequest + deserializeRequest", () => {
  it("roundtrip GET", async () => {
    const req = new Request("http://test.com/foo", { method: "GET" });
    const bytes = await serializeRequest(req);
    const out = deserializeRequest(bytes);
    expect(out.method).toBe("GET");
    expect(out.url).toBe("http://test.com/foo");
    expect(out.body.byteLength).toBe(0);
  });
  it("roundtrip POST with body", async () => {
    const req = new Request("http://test.com/bar", {
      method: "POST",
      body: "hello",
      headers: { "Content-Type": "text/plain" },
    });
    const bytes = await serializeRequest(req);
    const out = deserializeRequest(bytes);
    expect(out.method).toBe("POST");
    expect(new TextDecoder().decode(out.body)).toBe("hello");
    expect(out.headers["content-type"] || out.headers["Content-Type"]).toBe(
      "text/plain",
    );
  });
});

describe("serializeResponse + deserializeResponse", () => {
  it("roundtrip 200", () => {
    const bytes = serializeResponse(
      200,
      { "Content-Type": "text/html" },
      "<p>ok</p>",
    );
    const resp = deserializeResponse(bytes);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("text/html");
    return resp.text().then((t) => expect(t).toBe("<p>ok</p>"));
  });
  it("roundtrip 404", () => {
    const bytes = serializeResponse(404, {}, "Not Found");
    const resp = deserializeResponse(bytes);
    expect(resp.status).toBe(404);
    return resp.text().then((t) => expect(t).toBe("Not Found"));
  });
});
