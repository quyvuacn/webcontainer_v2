export class PathUtils {
  static normalize(path: string): string {
    const p = path != null ? String(path).replace(/\\/g, "/") : "";
    if (!p) return "/";
    const s = p.startsWith("/") ? p : "/" + p;
    const parts = s.slice(1).split("/");
    const stack: string[] = [];
    for (const part of parts) {
      if (part === "" || part === ".") continue;
      if (part === "..") {
        if (stack.length > 0) stack.pop();
      } else {
        stack.push(part);
      }
    }
    return "/" + stack.join("/");
  }

  static join(...segments: string[]): string {
    let result = "";
    for (const seg of segments) {
      if (!seg) continue;
      const s = String(seg).replace(/\\/g, "/");
      if (s.startsWith("/")) result = s;
      else result = result ? result + "/" + s : s;
    }
    return PathUtils.normalize(result || "/");
  }

  static dirname(path: string): string {
    const norm = PathUtils.normalize(path);
    if (norm === "/") return "/";
    const idx = norm.lastIndexOf("/");
    return idx <= 0 ? "/" : norm.slice(0, idx);
  }

  static basename(path: string, ext?: string): string {
    const norm = PathUtils.normalize(path);
    if (norm === "/") return "";
    const base = norm.split("/").pop() ?? "";
    if (ext && base.endsWith(ext)) return base.slice(0, -ext.length);
    return base;
  }

  static extname(path: string): string {
    const base = PathUtils.basename(path);
    const i = base.lastIndexOf(".");
    return i <= 0 ? "" : base.slice(i);
  }

  static resolve(...segments: string[]): string {
    // Right-to-left: stop at first absolute segment; join with '/' as final fallback
    const parts: string[] = [];
    let hasAbsolute = false;
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = String(segments[i] ?? "").replace(/\\/g, "/");
      if (!seg) continue;
      parts.unshift(seg);
      if (seg.startsWith("/")) {
        hasAbsolute = true;
        break;
      }
    }
    if (!hasAbsolute) parts.unshift("/");
    return PathUtils.normalize(parts.join("/"));
  }

  static isAbsolute(path: string): boolean {
    return String(path).replace(/\\/g, "/").startsWith("/");
  }

  static split(path: string): string[] {
    const norm = PathUtils.normalize(path);
    if (norm === "/") return [];
    return norm.slice(1).split("/").filter(Boolean);
  }
}
