import * as Path from "./path";
import { npmInstall } from "../npm/install";
import { npmCi } from "../npm/ci";
import { npmRun } from "../npm/run";

export interface ShellContext {
  args: string[];
  vfs: {
    stat: (
      p: string,
    ) => Promise<{ isFile?: () => boolean; isDirectory: () => boolean }>;
    readFile?: (p: string, enc: string) => Promise<string>;
    readdir?: (p: string) => Promise<string[]>;
    mkdir?: (p: string, opts: { recursive?: boolean }) => Promise<void>;
    rmdir?: (p: string, opts: { recursive: boolean }) => Promise<void>;
    unlink?: (p: string) => Promise<void>;
  };
  cwd: string;
  home: string;
  user?: string;
  write: (s: string) => void;
  writeln: (s: string) => void;
  oldPwd?: string | null;
  spawnNode?: (args: string[], opts: { cwd: string }) => Promise<number>;
  spawnSyncAsync?: (
    file: string,
    args: string[],
    opts: { cwd: string },
  ) => Promise<{ status?: number; stdout: string; stderr: string }>;
  vfsRead?: (p: string) => Uint8Array | null;
  vfsWrite?: (p: string, b: Uint8Array) => void;
  vfsAcquireLock?: (p: string) => number;
  vfsReleaseLock?: (id: number) => void;
  abortSignal?: AbortSignal;
}

const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function resolvePath(
  cwd: string,
  input: string | undefined,
  fallback: string | undefined,
  home = "project",
) {
  if (!input) return fallback ?? cwd;
  if (input === "~") return home;
  if (input.startsWith("~/")) return Path.join(home, input.slice(2));
  return Path.resolve(cwd, input);
}

export const commands: Record<
  string,
  (ctx: ShellContext) => Promise<{ exitCode: number; newCwd?: string }>
> = {
  pwd: async ({ cwd, writeln }) => {
    writeln(cwd);
    return { exitCode: 0 };
  },

  cd: async ({ args, vfs, cwd, writeln, oldPwd, home }) => {
    const h = (home as string) ?? "project";
    const raw = (args as string[])[0];
    if (raw === "-") {
      if (!oldPwd) {
        writeln(A.red + "cd: OLDPWD not set" + A.reset);
        return { exitCode: 1 };
      }
      return { newCwd: oldPwd!, exitCode: 0 };
    }
    let target =
      raw === ".." || raw === "."
        ? Path.resolve(cwd, raw)
        : resolvePath(cwd, raw, h, h);
    if (!target && raw !== ".." && raw !== ".") target = h;
    if (target === "") return { newCwd: "", exitCode: 0 };
    try {
      const stat = await (
        vfs as { stat: (p: string) => Promise<{ isDirectory: () => boolean }> }
      ).stat(target);
      if (!stat.isDirectory()) {
        writeln(A.red + `cd: not a directory: ${target}` + A.reset);
        return { exitCode: 1 };
      }
      return { newCwd: target, exitCode: 0 };
    } catch {
      writeln(A.red + `cd: no such file or directory: ${target}` + A.reset);
      return { exitCode: 1 };
    }
  },

  ls: async ({ args, vfs, cwd, writeln, home }) => {
    const pathArg = args.find((a) => !a.startsWith("-"));
    const target = resolvePath(cwd, pathArg, cwd, home ?? "project");
    try {
      const stat = await vfs.stat(target);
      if (stat.isFile()) {
        writeln(Path.basename(target));
        return { exitCode: 0 };
      }
      const entries = await vfs.readdir!(target);
      const sorted = entries.sort();
      const lines: string[] = [];
      for (const name of sorted) {
        if (
          name.startsWith(".") &&
          !(args as string[]).some((f) => f.includes("a"))
        )
          continue;
        try {
          const child = Path.join(target, name);
          const st = await vfs.stat(child);
          const display = st.isDirectory()
            ? A.blue + A.bold + name + "/" + A.reset
            : name;
          lines.push(display);
        } catch {
          lines.push(name);
        }
      }
      writeln(lines.join("  "));
      return { exitCode: 0 };
    } catch {
      writeln(
        A.red +
          `ls: cannot access '${target}': No such file or directory` +
          A.reset,
      );
      return { exitCode: 1 };
    }
  },

  cat: async ({ args, vfs, vfsRead, cwd, writeln, home }) => {
    if (!args.length) {
      writeln(A.red + "cat: missing operand" + A.reset);
      return { exitCode: 1 };
    }
    let exitCode = 0;
    for (const arg of args) {
      const target = resolvePath(cwd, arg, undefined, home ?? "project");
      const p = target.startsWith("/") ? target.slice(1) : target;
      try {
        let content: string | undefined;
        if (vfsRead) {
          const bytes = (vfsRead as (p: string) => Uint8Array | null)(p);
          if (bytes != null)
            content =
              typeof bytes === "string"
                ? bytes
                : new TextDecoder().decode(bytes);
        }
        if (content === undefined && vfs.readFile)
          content = await vfs.readFile(target, "utf8");
        writeln(
          typeof content === "string"
            ? content
            : new TextDecoder().decode(content),
        );
      } catch {
        writeln(A.red + `cat: ${target}: No such file or directory` + A.reset);
        exitCode = 1;
      }
    }
    return { exitCode };
  },

  mkdir: async ({ args, vfs, cwd, writeln, home }) => {
    const recursive = args.includes("-p");
    const paths = args.filter((a) => !a.startsWith("-"));
    if (!paths.length) {
      writeln(A.red + "mkdir: missing operand" + A.reset);
      return { exitCode: 1 };
    }
    for (const p of paths) {
      const target = resolvePath(cwd, p, undefined, home ?? "project");
      try {
        await vfs.mkdir!(target, { recursive });
      } catch (e) {
        writeln(A.red + `mkdir: ${(e as Error)?.message ?? e}` + A.reset);
        return { exitCode: 1 };
      }
    }
    return { exitCode: 0 };
  },

  rm: async ({ args, vfs, cwd, writeln, home }) => {
    const recursive = args.some((f) => /^-[Rr]f?$/.test(f));
    const paths = args.filter((a) => !a.startsWith("-"));
    if (!paths.length) {
      writeln(A.red + "rm: missing operand" + A.reset);
      return { exitCode: 1 };
    }
    for (const p of paths) {
      const target = resolvePath(
        cwd as string,
        p,
        undefined,
        (home as string) ?? "project",
      );
      try {
        const stat = await (
          vfs as {
            stat: (p: string) => Promise<{ isDirectory: () => boolean }>;
          }
        ).stat(target);
        if (stat.isDirectory()) {
          if (!recursive) {
            writeln(
              A.red + `rm: cannot remove '${target}': is a directory` + A.reset,
            );
            return { exitCode: 1 };
          }
          await vfs.rmdir!(target, { recursive: true });
        } else {
          await vfs.unlink!(target);
        }
      } catch {
        writeln(A.red + `rm: cannot remove '${target}'` + A.reset);
        return { exitCode: 1 };
      }
    }
    return { exitCode: 0 };
  },

  echo: async ({ args, write, writeln }) => {
    const noNewline = args.includes("-n");
    const toPrint = args.filter((a) => a !== "-n").join(" ");
    noNewline ? write(toPrint) : writeln(toPrint);
    return { exitCode: 0 };
  },

  clear: async ({ write }) => {
    (write as (s: string) => void)("\x1b[2J\x1b[H");
    return { exitCode: 0 };
  },

  help: async ({ writeln }) => {
    const list: [string, string][] = [
      ["pwd", "print working directory"],
      ["cd [dir]", "change directory"],
      ["ls [-a] [dir]", "list directory"],
      ["cat <file>", "print file"],
      ["mkdir [-p] <dir>", "create directory"],
      ["rm [-rf] <path>", "remove"],
      ["echo [args]", "print"],
      ["node <file>", "run JS file"],
      ["curl [-X method] [-H header] [-d data] [-o file] <url>", "HTTP client"],
      ["npm install|ci|run [script]", "package manager"],
      ["clear", "clear terminal"],
      ["help", "show help"],
    ];
    writeln(A.bold + A.cyan + "Commands:" + A.reset);
    for (const [cmd, desc] of list) {
      writeln("  " + (cmd ?? "").padEnd(20) + (desc ?? ""));
    }
    return { exitCode: 0 };
  },

  curl: async ({ args, vfs, vfsWrite, cwd, writeln, write, abortSignal }) => {
    const argv = args as string[];

    // Parse flags
    let method = "GET";
    const headers: Record<string, string> = {};
    let data: string | undefined;
    let outputFile: string | undefined;
    let verbose = false;
    let silent = false;
    let includeHeaders = false;
    let headOnly = false;
    let url: string | undefined;

    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === "-X" || a === "--request") {
        method = argv[++i] ?? method;
      } else if (a === "-H" || a === "--header") {
        const h = argv[++i] ?? "";
        const ci = h.indexOf(":");
        if (ci > 0)
          headers[h.slice(0, ci).trim().toLowerCase()] = h.slice(ci + 1).trim();
      } else if (a === "-d" || a === "--data" || a === "--data-raw") {
        data = argv[++i];
      } else if (a === "--json") {
        data = argv[++i];
        headers["content-type"] ??= "application/json";
        headers["accept"] ??= "application/json";
      } else if (a === "-o" || a === "--output") {
        outputFile = argv[++i];
      } else if (a === "-v" || a === "--verbose") {
        verbose = true;
      } else if (a === "-s" || a === "--silent") {
        silent = true;
      } else if (a === "-i" || a === "--include") {
        includeHeaders = true;
      } else if (a === "-I" || a === "--head") {
        headOnly = true;
        method = "HEAD";
      } else if (a === "-L" || a === "--location") {
        /* fetch follows redirects by default */
      } else if (!a.startsWith("-")) {
        url = a;
      } else if (a.startsWith("-X")) {
        method = a.slice(2);
      }
    }

    if (!url) {
      writeln(A.red + "curl: no URL specified" + A.reset);
      writeln(
        'Usage: curl [-X method] [-H "Header: value"] [-d data] [-o file] [-viIsL] <url>',
      );
      return { exitCode: 1 };
    }

    // Rewrite localhost:PORT to /__port__/PORT/path so SW can intercept
    let fetchUrl = url;
    try {
      const u = new URL(url.startsWith("http") ? url : "http://" + url);
      const isLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1";
      if (isLocal && u.port) {
        fetchUrl = `/__port__/${u.port}${u.pathname}${u.search}`;
      }
    } catch {
      /* keep original url */
    }

    if (data && method === "GET") method = "POST";

    if (verbose) {
      writeln(A.dim + `> ${method} ${fetchUrl}` + A.reset);
      for (const [k, v] of Object.entries(headers))
        writeln(A.dim + `> ${k}: ${v}` + A.reset);
      if (data) writeln(A.dim + `> [body: ${data.length} bytes]` + A.reset);
    }

    let resp: Response;
    try {
      resp = await fetch(fetchUrl, {
        method,
        headers,
        body: data ?? undefined,
        signal: abortSignal,
      });
    } catch (e) {
      if (abortSignal?.aborted) return { exitCode: 130 };
      if (!silent)
        writeln(A.red + `curl: ${(e as Error)?.message ?? e}` + A.reset);
      return { exitCode: 1 };
    }

    if (abortSignal?.aborted) return { exitCode: 130 };
    if (verbose || includeHeaders) {
      writeln(
        A.dim + `< HTTP/${resp.status} ${resp.statusText || ""}` + A.reset,
      );
      resp.headers.forEach((v, k) => writeln(A.dim + `< ${k}: ${v}` + A.reset));
      writeln("");
    } else if (!silent) {
      // show status line for non-2xx
      if (!resp.ok)
        writeln(A.yellow + `HTTP ${resp.status} ${resp.statusText}` + A.reset);
    }

    if (headOnly) return { exitCode: resp.ok ? 0 : 1 };

    const buf = await resp.arrayBuffer();
    if (abortSignal?.aborted) return { exitCode: 130 };
    const bytes = new Uint8Array(buf);

    if (outputFile) {
      const outPath = Path.resolve(cwd as string, outputFile);
      try {
        if (vfsWrite) vfsWrite(outPath, bytes);
        else if ("writeFile" in vfs)
          await (
            vfs as unknown as {
              writeFile: (p: string, b: string) => Promise<void>;
            }
          ).writeFile(outPath, new TextDecoder().decode(bytes));
        if (!silent && !abortSignal?.aborted)
          writeln(
            `  % Total    % Received\n100  ${bytes.length}  100  ${bytes.length}`,
          );
      } catch (e) {
        if (abortSignal?.aborted) return { exitCode: 130 };
        writeln(
          A.red +
            `curl: cannot write to ${outputFile}: ${(e as Error)?.message ?? e}` +
            A.reset,
        );
        return { exitCode: 1 };
      }
    } else {
      if (abortSignal?.aborted) return { exitCode: 130 };
      // Try to decode as UTF-8 text; fall back to hex dump for binary
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      const hasBinary = bytes.some((b) => b === 0);
      if (hasBinary) {
        writeln(
          A.yellow +
            `[binary data: ${bytes.length} bytes — use -o <file> to save]` +
            A.reset,
        );
      } else {
        write(text);
        if (text && !text.endsWith("\n")) writeln("");
      }
    }

    return { exitCode: resp.ok ? 0 : 1 };
  },

  node: async ({ args, cwd, writeln, spawnNode }) => {
    if (!args.length) {
      writeln(A.red + "node: usage: node <file> [args...]" + A.reset);
      return { exitCode: 1 };
    }
    if (!spawnNode) {
      writeln(A.yellow + "node: spawnNode not configured" + A.reset);
      return { exitCode: 1 };
    }
    return { exitCode: await spawnNode!(args, { cwd }) };
  },

  npm: async ({
    args,
    cwd,
    writeln,
    vfsRead,
    vfsWrite,
    vfsAcquireLock,
    vfsReleaseLock,
    spawnNode,
  }) => {
    if (!args.length) {
      writeln("npm <install|ci|run|start> [args...]");
      return { exitCode: 0 };
    }
    const sub = args[0];
    try {
      if (sub === "install" || sub === "i") {
        const r = await npmInstall(
          vfsRead!,
          vfsWrite!,
          vfsAcquireLock!,
          vfsReleaseLock!,
          cwd,
          undefined,
          { prefetch: true },
        );
        writeln(`added ${r.added} packages`);
        return { exitCode: 0 };
      }
      if (sub === "ci") {
        const r = await npmCi(
          vfsRead!,
          vfsWrite!,
          vfsAcquireLock!,
          vfsReleaseLock!,
          cwd,
          { prefetch: true },
        );
        writeln(`ci ${r.added} packages`);
        return { exitCode: 0 };
      }
      if (sub === "run" || sub === "start") {
        const script = args[1] || (sub === "start" ? "start" : null);
        if (!script) {
          writeln(A.red + "npm run: missing script name" + A.reset);
          return { exitCode: 1 };
        }
        if (!spawnNode) throw new Error("spawnNode not configured");
        const result = await npmRun(
          script,
          vfsRead!,
          spawnNode!,
          cwd,
          vfsWrite,
        );
        return { exitCode: result.status ?? 1 };
      }
      writeln(A.red + `npm: unknown command ${sub}` + A.reset);
      return { exitCode: 1 };
    } catch (e) {
      writeln(A.red + `npm: ${(e as Error)?.message ?? e}` + A.reset);
      return { exitCode: 1 };
    }
  },
};
