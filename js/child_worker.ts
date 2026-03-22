import { hasRequire, createRequire } from "./cjs_loader";

let vfsPort: MessagePort | null = null;
let ipcPort: MessagePort | null = null;
let stdout: SharedArrayBuffer | null = null;
let stderr: SharedArrayBuffer | null = null;
let done: SharedArrayBuffer | null = null;

function vfsRead(path: string) {
  return new Promise<Uint8Array | null>((resolve) => {
    const id = crypto.randomUUID();
    const handler = ({
      data: d,
    }: MessageEvent<{ id: string; bytes?: number[] }>) => {
      if (d.id !== id) return;
      vfsPort!.removeEventListener("message", handler);
      resolve(d.bytes ? new Uint8Array(d.bytes) : null);
    };
    vfsPort!.addEventListener("message", handler);
    vfsPort!.postMessage({ op: "read", path, id });
  });
}

function vfsWrite(path: string, bytes: Uint8Array) {
  return new Promise<void>((resolve) => {
    const id = crypto.randomUUID();
    const handler = ({ data: d }: MessageEvent<{ id: string }>) => {
      if (d.id !== id) return;
      vfsPort!.removeEventListener("message", handler);
      resolve();
    };
    vfsPort!.addEventListener("message", handler);
    vfsPort!.postMessage({
      op: "write",
      path,
      bytes: [...new Uint8Array(bytes)],
      id,
    });
  });
}

function writeTo(buf: SharedArrayBuffer | null, data: string | Uint8Array) {
  if (!buf) return;
  const arr = new Uint8Array(buf);
  const view = new DataView(buf);
  const lenOff = buf.byteLength - 4;
  const used = view.getUint32(lenOff, true);
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : new Uint8Array(data);
  arr.set(bytes, used);
  view.setUint32(lenOff, used + bytes.length, true);
}

async function runScript(
  file: string,
  args: string[],
  env: Record<string, string>,
) {
  let exitCode = 0;
  const bytes = await vfsRead(file);
  if (!bytes) {
    writeTo(stderr, `Error: Cannot find module '${file}'\n`);
    exitCode = 1;
    if (done) {
      new Int32Array(done)[0] = exitCode;
      (self as Worker).postMessage({ type: "done" });
    }
    return;
  }
  const code = new TextDecoder().decode(bytes);
  const out = { buf: stdout, write: (s: string) => writeTo(stdout, s) };
  const err = { buf: stderr, write: (s: string) => writeTo(stderr, s) };
  const proc = { argv: [file, ...args], env };
  const projectRoot = file.split("/")[0] || "project";

  try {
    if (hasRequire(code)) {
      const req = createRequire((p) => vfsRead(p), projectRoot);
      const mod = { exports: {} as Record<string, unknown> };
      const dir = file.replace(/\/[^/]+$/, "");
      const transformed = code.replace(
        /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        "(await require('$1'))",
      );
      const fn = new Function(
        "process",
        "require",
        "console",
        "exports",
        "module",
        `(async function() {
          const __dirname = '${dir}';
          const __filename = '${file}';
          ${transformed}
          return module.exports;
        })()`,
      );
      await fn(
        proc,
        req,
        { log: (...a: unknown[]) => out.write(a.join(" ") + "\n") },
        mod.exports,
        mod,
      );
    } else {
      const mod = { exports: {} as Record<string, unknown> };
      const fn = new Function(
        "process",
        "require",
        "console",
        "exports",
        "module",
        code,
      );
      fn(
        proc,
        () => {},
        { log: (...a: unknown[]) => out.write(a.join(" ") + "\n") },
        mod.exports,
        mod,
      );
    }
  } catch (e) {
    err.write(String(e) + "\n");
    exitCode = 1;
  }
  if (done) {
    new Int32Array(done)[0] = exitCode;
    (self as Worker).postMessage({ type: "done" });
  }
}

(self as Worker).onmessage = ({
  data,
}: MessageEvent<{
  vfsPort?: MessagePort;
  ipcPort?: MessagePort;
  stdout?: SharedArrayBuffer;
  stderr?: SharedArrayBuffer;
  done?: SharedArrayBuffer;
  file?: string;
  args?: string[];
  env?: Record<string, string>;
}>) => {
  vfsPort = data.vfsPort!;
  ipcPort = data.ipcPort!;
  stdout = data.stdout!;
  stderr = data.stderr!;
  done = data.done!;
  runScript(data.file!, data.args || [], data.env || {});
};
