/**
 * Node querystring polyfill — parse, stringify, escape, unescape.
 * Legacy module; modern code should use url.URLSearchParams instead.
 */

export function createQuerystringPolyfill(): Record<string, unknown> {
  function escape(str: string): string {
    return encodeURIComponent(String(str))
      .replace(/!/g, "%21")
      .replace(/'/g, "%27")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29")
      .replace(/\*/g, "%2A");
  }

  function unescape(str: string): string {
    try {
      return decodeURIComponent(str.replace(/\+/g, " "));
    } catch {
      return str;
    }
  }

  function parse(
    str: string,
    sep?: string | null,
    eq?: string | null,
    _options?: Record<string, unknown>,
  ): Record<string, string | string[]> {
    const separator = sep ?? "&";
    const equals = eq ?? "=";
    const result: Record<string, string | string[]> = Object.create(null);
    if (!str || typeof str !== "string") return result;
    const parts = str.split(separator);
    for (const part of parts) {
      if (!part) continue;
      const idx = part.indexOf(equals);
      let key: string;
      let val: string;
      if (idx < 0) {
        key = unescape(part);
        val = "";
      } else {
        key = unescape(part.slice(0, idx));
        val = unescape(part.slice(idx + 1));
      }
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        const existing = result[key];
        if (Array.isArray(existing)) {
          existing.push(val);
        } else {
          result[key] = [existing as string, val];
        }
      } else {
        result[key] = val;
      }
    }
    return result;
  }

  function stringify(
    obj: Record<string, unknown>,
    sep?: string | null,
    eq?: string | null,
    _options?: Record<string, unknown>,
  ): string {
    const separator = sep ?? "&";
    const equals = eq ?? "=";
    if (!obj || typeof obj !== "object") return "";
    const parts: string[] = [];
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      const encodedKey = escape(key);
      if (Array.isArray(val)) {
        for (const v of val) {
          parts.push(encodedKey + equals + escape(String(v)));
        }
      } else if (val !== null && val !== undefined) {
        parts.push(encodedKey + equals + escape(String(val)));
      } else {
        parts.push(encodedKey + equals);
      }
    }
    return parts.join(separator);
  }

  const polyfill = {
    parse,
    stringify,
    escape,
    unescape,
    decode: parse,
    encode: stringify,
    default: {} as Record<string, unknown>,
  };
  polyfill.default = polyfill;
  return polyfill;
}
