/**
 * Node url module polyfill — wraps URL and URLSearchParams.
 */

import { PathUtils } from "../vfs/core/path";
import { WC_ENTRY_PATH, WC_VFS_PREFIX } from "../../js/lib/wc_globals";

function resolvePath(cwd: string, p: string): string {
  if (PathUtils.isAbsolute(p)) return PathUtils.normalize(p);
  return PathUtils.join(cwd, p);
}

export interface UrlPolyfillOptions {
  getCwd?: () => string;
}

export function createUrlPolyfill(options: UrlPolyfillOptions = {}) {
  const getCwd = options.getCwd ?? (() => "/");
  return {
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,

    fileURLToPath(url: string | URL): string {
      const u = typeof url === "string" ? new URL(url) : url;
      if (u.protocol === "blob:") {
        const entry = (globalThis as Record<string, unknown>)[WC_ENTRY_PATH] as
          | string
          | undefined;
        if (entry) return entry;
      }
      if (u.protocol === "wc-file:") {
        return decodeURIComponent(u.pathname.replace(/^\/([a-zA-Z]:)/, "$1"));
      }
      // /__r__/ or /__wc__/ URLs (Service Worker file serving)
      if (
        (u.protocol === "https:" || u.protocol === "http:") &&
        u.pathname.startsWith("/__wc__/")
      ) {
        return decodeURIComponent(u.pathname.slice(8));
      }
      if (
        (u.protocol === "https:" || u.protocol === "http:") &&
        u.pathname.match(/^\/__[^/]+__\//)
      ) {
        // Strip the VFS prefix (e.g. /__r__/ or /__a3f1__/) to get the VFS path
        return decodeURIComponent(u.pathname.replace(/^\/__[^/]+__\//, "/"));
      }
      if (u.protocol !== "file:")
        throw new Error(`Invalid URL protocol: ${u.protocol}`);
      return decodeURIComponent(u.pathname.replace(/^\/([a-zA-Z]:)/, "$1"));
    },

    pathToFileURL(path: string): URL {
      const normalized = path.replace(/\\/g, "/");
      // In browser (main thread or Web Worker): return /__r__/ URL served by Service Worker from VFS.
      if (
        typeof location !== "undefined" &&
        typeof location.origin === "string"
      ) {
        const vfsPrefix =
          ((globalThis as Record<string, unknown>)[WC_VFS_PREFIX] as
            | string
            | undefined) ?? "__r__";
        const wcPath = resolvePath(getCwd(), normalized);
        return new URL(
          location.origin +
            "/" +
            vfsPrefix +
            "/" +
            (wcPath.startsWith("/") ? wcPath.slice(1) : wcPath),
        );
      }
      const prefix = normalized.startsWith("/") ? "file://" : "file:///";
      return new URL(prefix + encodeURI(normalized));
    },

    parse(
      url: string,
      parseQueryString?: boolean,
      _slashesDenoteHost?: boolean,
    ): Record<string, unknown> {
      try {
        const u = new URL(url);
        const result: Record<string, unknown> = {
          protocol: u.protocol,
          slashes: true,
          auth:
            u.username && u.password
              ? `${u.username}:${u.password}`
              : u.username || u.password || null,
          host: u.host,
          port: u.port || null,
          hostname: u.hostname,
          hash: u.hash || null,
          search: u.search || null,
          query: parseQueryString
            ? (() => {
                const o: Record<string, string> = {};
                u.searchParams.forEach((v, k) => {
                  o[k] = v;
                });
                return o;
              })()
            : u.search?.slice(1) || null,
          pathname: u.pathname,
          path: u.pathname + (u.search || ""),
          href: u.href,
        };
        return result;
      } catch {
        return { href: url, path: url, pathname: url };
      }
    },

    format(obj: Record<string, unknown>): string {
      const protocol = (obj.protocol as string) || "http:";
      const host = (obj.host as string) || (obj.hostname as string) || "";
      const pathname = (obj.pathname as string) || "/";
      const search = (obj.search as string) || "";
      const hash = (obj.hash as string) || "";
      if (host) return `${protocol}//${host}${pathname}${search}${hash}`;
      return `${pathname}${search}${hash}`;
    },

    resolve(from: string, to: string): string {
      try {
        return new URL(to, new URL(from, "file:///")).href;
      } catch {
        return to;
      }
    },
  };
}
