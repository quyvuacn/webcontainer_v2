import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { bootstrap } from "./main";
import {
  createNodeRunner,
  createSpawnSyncAsync,
  terminateWorkerInSlot,
  type WorkerRefSlot,
} from "./run_node";
import { installNodeRuntimeHooks } from "../node/polyfills/node-runtime-hooks";
import { createVirtualFSAdapter } from "../node/vfs/core/adapter";
import { createShellVfsAdapter } from "./shell/vfs_adapter";
import { Shell } from "./shell/shell";
import * as Path from "./shell/path";

const termOpts = {
  theme: { background: "#0d1117", foreground: "#c9d1d9", cursor: "#58a6ff" },
  fontFamily: '"Cascadia Code", "Fira Code", monospace',
  fontSize: 14,
  cursorBlink: true,
  scrollback: 1000,
  disableStdin: false,
};

let termCount = 0;
type RamVfs = {
  read: (p: string) => Uint8Array | null;
  write: (p: string, b: Uint8Array | string) => void;
  exists: (p: string) => boolean;
  readdir?: (p: string) => string[];
  stat?: (
    p: string,
  ) => { isFile: () => boolean; isDirectory: () => boolean } | null;
  mkdir?: (p: string) => void;
  dirs?: Set<string>;
  files?: Map<string, { content: Uint8Array; mtime?: number; mode?: number }>;
  acquireLock: (p: string) => number;
  releaseLock: (id: number) => void;
};

const UBUNTU_DIRS = [
  "bin",
  "dev",
  "etc",
  "home/user",
  "tmp",
  "usr/bin",
  "usr/local/bin",
  "project",
];
const BIN_PLACEHOLDERS: Record<string, string> = {
  bin: "cat chmod cp echo grep hostname ls mkdir mv pwd rm",
  "usr/bin":
    "alias cd clear env false find head help sort tail touch true wc which",
  "usr/local/bin": "node npm",
};

function initUbuntuStructure(vfs: RamVfs) {
  vfs.dirs?.add?.("");
  for (const dir of UBUNTU_DIRS) {
    vfs.mkdir?.(dir);
  }
  for (const [dir, names] of Object.entries(BIN_PLACEHOLDERS)) {
    for (const name of names.split(/\s+/)) {
      const path = `${dir}/${name}`;
      if (!vfs.exists(path)) vfs.write(path, "");
    }
  }
  const etcFiles: [string, string][] = [
    [
      "etc/passwd",
      "root:x:0:0:root:/root:/bin/bash\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\nuser:x:1000:1000:WebContainer User:/home/user:/bin/bash\n",
    ],
    ["etc/group", "root:x:0:\nusers:x:100:user\nnogroup:x:65534:\n"],
    ["etc/hosts", "127.0.0.1\tlocalhost\n127.0.1.1\tbrowser-node\n"],
    ["etc/hostname", "browser-node\n"],
    [
      "etc/os-release",
      'PRETTY_NAME="Ubuntu 22.04 LTS"\nNAME="Ubuntu"\nVERSION_ID="22.04"\nID=ubuntu\n',
    ],
    ["etc/shells", "# valid login shells\n/bin/sh\n/bin/bash\n/usr/bin/bash\n"],
    [
      "etc/motd",
      "Welcome to Browser Node\nUbuntu 22.04 LTS - virtual environment\n",
    ],
  ];
  for (const [path, content] of etcFiles) {
    if (!vfs.exists(path)) vfs.write(path, content);
  }
  for (const name of ["null", "zero", "random", "urandom", "tty"]) {
    const path = `dev/${name}`;
    if (!vfs.exists(path)) vfs.write(path, "");
  }
  if (!vfs.exists("home/user/.bashrc")) {
    vfs.write(
      "home/user/.bashrc",
      "# ~/.bashrc: executed by bash(1) for non-login shells.\n# Browser Node virtual environment\n\ncase $- in\n    *i*) ;;\n      *) return;;\nesac\n",
    );
  }
  if (!vfs.exists("home/user/.profile")) {
    vfs.write(
      "home/user/.profile",
      '# ~/.profile: executed by the command interpreter for login shells.\nif [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi\n',
    );
  }
  if (!vfs.exists("home/user/welcome.txt")) {
    vfs.write(
      "home/user/welcome.txt",
      "Welcome to Browser Node!\nVirtual filesystem in the browser.\ncd project to work on your app.\n",
    );
  }
}
let vfs: RamVfs | null = null;
let createServerFn:
  | ((handler: (req: unknown, res: unknown) => void) => {
      listen: (port: number) => void;
    })
  | null = null;

function createTerminal(container: HTMLElement, writeWelcome = false) {
  const term = new Terminal(termOpts);
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  if (writeWelcome) {
    term.writeln("\x1b[1;34m╔═══════════════════════════════════════╗\x1b[0m");
    term.writeln(
      "\x1b[1;34m║   \x1b[1;32mBrowser Node Shell\x1b[1;34m                 ║\x1b[0m",
    );
    term.writeln(
      "\x1b[1;34m║   \x1b[2mVirtual FS in browser\x1b[1;34m                 ║\x1b[0m",
    );
    term.writeln("\x1b[1;34m╚═══════════════════════════════════════╝\x1b[0m");
    term.writeln("");
    term.writeln("Type \x1b[33mhelp\x1b[0m for commands.");
    term.writeln("");
  }
  return { term, fitAddon };
}

function createShellState(vfs: RamVfs, term: Terminal) {
  const shellVfs = createShellVfsAdapter(vfs);
  const toTerm = (t: string) => term.write(t.replace(/\r?\n/g, "\r\n"));
  const terminal = {
    write: toTerm,
    writeError: (t: string) =>
      term.write("\x1b[31m" + t.replace(/\r?\n/g, "\r\n") + "\x1b[0m"),
  };
  const workerRefSlot: WorkerRefSlot = { current: null };
  const spawnNode = createNodeRunner(vfs, terminal, workerRefSlot);
  const spawnSyncAsync = createSpawnSyncAsync(vfs);
  const shell = new Shell(shellVfs as Shell["vfs"], toTerm, {
    cwd: "home/user/projects",
    home: "home/user",
    user: "user",
    spawnNode,
    spawnSyncAsync,
    vfs,
    vfsRead: (p: string) => vfs.read(p),
    vfsWrite: (p: string, b: Uint8Array) => vfs.write(p, b),
    vfsAcquireLock: (p: string) => vfs.acquireLock(p),
    vfsReleaseLock: (id: number) => vfs.releaseLock(id),
  });
  return {
    shell,
    lineBuffer: "",
    cursorIndex: 0,
    history: [] as string[],
    historyIdx: -1,
    workerRefSlot,
  };
}

function wireInput(meta: {
  term: Terminal;
  shell: Shell;
  state: {
    lineBuffer: string;
    cursorIndex: number;
    history: string[];
    historyIdx: number;
    workerRefSlot: WorkerRefSlot;
  };
}) {
  const { term, shell, state } = meta;
  function redrawLine() {
    term.write("\r\x1b[K" + shell.getPrompt() + state.lineBuffer);
    if (state.cursorIndex < state.lineBuffer.length)
      term.write(`\x1b[${state.lineBuffer.length - state.cursorIndex}D`);
  }
  function handleData(data: string) {
    if (data === "\r" || data === "\n") {
      term.write("\r\n");
      const line = state.lineBuffer.trim();
      if (line) state.history.unshift(line);
      state.historyIdx = -1;
      shell.execute(state.lineBuffer).then(() => {
        state.lineBuffer = "";
        state.cursorIndex = 0;
        term.write(shell.getPrompt());
      });
      return;
    }
    if (data === "\x7f" || data === "\b") {
      if (state.cursorIndex > 0) {
        state.lineBuffer =
          state.lineBuffer.slice(0, state.cursorIndex - 1) +
          state.lineBuffer.slice(state.cursorIndex);
        state.cursorIndex--;
        term.write("\b\x1b[P");
      }
      return;
    }
    if (data === "\x03") {
      term.write("^C\r\n");
      state.lineBuffer = "";
      state.cursorIndex = 0;
      if (terminateWorkerInSlot(state.workerRefSlot)) return;
      shell.abortCurrentCommand();
      const emit = (globalThis as { __wcEmitSIGINT?: () => void })
        .__wcEmitSIGINT;
      if (emit) emit();
      else term.write(shell.getPrompt());
      return;
    }
    if (data === "\x0c") {
      term.write("\x1b[2J\x1b[H");
      redrawLine();
      return;
    }
    if (data === "\t") {
      shell
        .complete(state.lineBuffer)
        .then(({ completions, replaceFrom, replaceTo }) => {
          if (!completions.length) {
            term.write("\x07");
            return;
          }
          const prefix = state.lineBuffer.substring(replaceFrom, replaceTo);
          if (completions.length === 1) {
            state.lineBuffer =
              state.lineBuffer.slice(0, replaceFrom) +
              completions[0] +
              state.lineBuffer.slice(replaceTo);
            state.cursorIndex = replaceFrom + completions[0].length;
            term.write("\b \b".repeat(prefix.length) + completions[0]);
          } else {
            const common = completions.reduce((a: string, b: string) => {
              let i = 0;
              while (i < a.length && i < b.length && a[i] === b[i]) i++;
              return a.slice(0, i);
            }, completions[0] || "");
            if (common.length > prefix.length) {
              state.lineBuffer =
                state.lineBuffer.slice(0, replaceFrom) +
                common +
                state.lineBuffer.slice(replaceTo);
              state.cursorIndex = replaceFrom + common.length;
              term.write("\b \b".repeat(prefix.length) + common);
            }
          }
        });
      return;
    }
    if (data === "\x1b[D" || data === "\x1bOD") {
      if (state.cursorIndex > 0) {
        state.cursorIndex--;
        term.write("\x1b[D");
      }
      return;
    }
    if (data === "\x1b[C" || data === "\x1bOC") {
      if (state.cursorIndex < state.lineBuffer.length) {
        state.cursorIndex++;
        term.write("\x1b[C");
      }
      return;
    }
    if (data === "\x1b[H" || data === "\x1b[1~" || data === "\x01") {
      if (state.cursorIndex > 0) {
        term.write(`\x1b[${state.cursorIndex}D`);
        state.cursorIndex = 0;
      }
      return;
    }
    if (data === "\x1b[F" || data === "\x1b[4~" || data === "\x05") {
      if (state.cursorIndex < state.lineBuffer.length) {
        const n = state.lineBuffer.length - state.cursorIndex;
        state.cursorIndex = state.lineBuffer.length;
        term.write(`\x1b[${n}C`);
      }
      return;
    }
    if (data === "\x1b[A" || data === "\x1bOA") {
      if (state.history.length && state.historyIdx < state.history.length - 1) {
        state.historyIdx = Math.min(
          state.historyIdx + 1,
          state.history.length - 1,
        );
        state.lineBuffer = state.history[state.historyIdx] ?? "";
        state.cursorIndex = state.lineBuffer.length;
        redrawLine();
      }
      return;
    }
    if (data === "\x1b[B" || data === "\x1bOB") {
      if (state.historyIdx > 0) {
        state.historyIdx--;
        state.lineBuffer = state.history[state.historyIdx] ?? "";
        state.cursorIndex = state.lineBuffer.length;
        redrawLine();
      } else if (state.historyIdx === 0) {
        state.historyIdx = -1;
        state.lineBuffer = "";
        state.cursorIndex = 0;
        redrawLine();
      }
      return;
    }
    if (data.startsWith("\x1b")) return;

    if (state.cursorIndex === state.lineBuffer.length) {
      state.lineBuffer += data;
      state.cursorIndex += data.length;
      term.write(data);
    } else {
      state.lineBuffer =
        state.lineBuffer.slice(0, state.cursorIndex) +
        data +
        state.lineBuffer.slice(state.cursorIndex);
      state.cursorIndex += data.length;
      redrawLine();
    }
  }
  term.onData(handleData);
}

function doFit(fitAddon: FitAddon) {
  requestAnimationFrame(() => {
    fitAddon.fit();
    setTimeout(() => fitAddon.fit(), 100);
  });
}

async function init() {
  const title = document.getElementById("title")!;
  const tabsEl = document.getElementById("tabs")!;
  const wrapperEl = document.getElementById("terminal-wrapper")!;

  const term = new Terminal(termOpts);
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  const tempDiv = document.createElement("div");
  tempDiv.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px";
  wrapperEl.appendChild(tempDiv);
  term.open(tempDiv);
  term.writeln("\x1b[2mStarting...\x1b[0m");

  doFit(fitAddon);
  window.addEventListener("resize", () => fitAddon.fit());

  try {
    const bootstrapPromise = bootstrap();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Bootstrap timeout (5s). Try F5 to retry.")),
        5000,
      ),
    );
    const boot = await Promise.race([bootstrapPromise, timeout]);
    vfs = boot.vfs;
    createServerFn = boot.createServer;
    title.textContent = "Browser Node — Virtual Shell";

    term.write("\x1b[2K\x1b[1G");

    if (!vfs.exists("etc/passwd")) {
      initUbuntuStructure(vfs);
    } else {
      vfs.dirs?.add?.("");
    }

    try {
      const res = await fetch("/sample_vite.json");
      if (res.ok) {
        const { files } = (await res.json()) as {
          files?: Record<string, string>;
        };
        if (files) {
          for (const [path, content] of Object.entries(files)) {
            vfs.write("home/user/projects/" + path, content);
          }
        }
      }
    } catch {}
    // if (!vfs.read("/home/user/projects/package.json")) {
    //   console.log(123);

    //   vfs.write(
    //     "/home/user/projects/package.json",
    //     JSON.stringify({ name: "demo", dependencies: { lodash: "^4.17.21" } }),
    //   );
    //   vfs.write(
    //     "/home/user/projects/hello.js",
    //     'console.log("Hello!"); process.argv.forEach((a,i)=>console.log(i,a))',
    //   );
    //   vfs.write(
    //     "/home/user/projects/index.html",
    //     "<html><body><h1>Browser Node</h1><p>F5 restores</p></body></html>",
    //   );
    //   vfs.write(
    //     "/home/user/projects/server.js",
    //     'const http=require("http");const PORT=5173;http.createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html"});res.end("<h1>OK</h1>")}).listen(PORT,()=>console.log("Server :"+PORT))',
    //   );
    // }

    wrapperEl.removeChild(tempDiv);
    const terminals: Array<{
      term: Terminal;
      fitAddon: FitAddon;
      shell: Shell;
      state: {
        lineBuffer: string;
        cursorIndex: number;
        history: string[];
        historyIdx: number;
        workerRefSlot: WorkerRefSlot;
      };
      tabEl: HTMLElement;
      panelEl: HTMLElement;
    }> = [];
    let activeIdx = 0;

    function switchTo(idx: number) {
      terminals.forEach((t, i) => {
        t.panelEl.classList.toggle("active", i === idx);
        t.tabEl.classList.toggle("active", i === idx);
      });
      activeIdx = idx;
      doFit(terminals[idx].fitAddon);
      terminals[idx].term.focus();
    }

    function addTerminal(writeWelcome = false) {
      termCount++;
      const tabEl = document.createElement("div");
      tabEl.className = "tab" + (terminals.length === 0 ? " active" : "");
      tabEl.textContent = `term-${termCount}`;
      const closeBtn = document.createElement("span");
      closeBtn.className = "tab-close";
      closeBtn.textContent = "×";
      closeBtn.onclick = (e: MouseEvent) => {
        e.stopPropagation();
        if (terminals.length <= 1) return;
        const idx = terminals.findIndex((t) => t.tabEl === tabEl);
        const wasActive = idx === activeIdx;
        const newIdx = wasActive
          ? idx > 0
            ? idx - 1
            : 0
          : activeIdx > idx
            ? activeIdx - 1
            : activeIdx;
        terminateWorkerInSlot(terminals[idx].state.workerRefSlot);
        tabEl.remove();
        terminals[idx].panelEl.remove();
        terminals.splice(idx, 1);
        terminals.forEach((t) => {
          (t.tabEl.querySelector(".tab-close") as HTMLElement).style.display =
            terminals.length > 1 ? "" : "none";
        });
        switchTo(Math.min(newIdx, terminals.length - 1));
      };
      tabEl.appendChild(closeBtn);

      const panelEl = document.createElement("div");
      panelEl.className =
        "terminal-panel" + (terminals.length === 0 ? " active" : "");
      const containerEl = document.createElement("div");
      containerEl.className = "terminal-el";
      panelEl.appendChild(containerEl);

      const { term: t, fitAddon: fa } = createTerminal(
        containerEl,
        writeWelcome,
      );
      const state = createShellState(vfs, t);
      if (terminals.length === 0 && boot.registerWorkerVfsPort) {
        installNodeRuntimeHooks({
          vfs: createVirtualFSAdapter(vfs),
          setupVirtualPort: boot.setupVirtualPort,
          runNode: state.shell.spawnNode!,
          registerWorkerVfsPort: boot.registerWorkerVfsPort,
          workerThreadsWorkerUrl: "/js/worker_threads_runner.ts",
        });
      }
      wireInput({ term: t, shell: state.shell, state });
      if (writeWelcome) {
        t.write(state.shell.getPrompt());
      }
      doFit(fa);

      tabEl.onclick = () => {
        if (tabEl.classList.contains("active")) return;
        const idx = terminals.findIndex((x) => x.tabEl === tabEl);
        switchTo(idx);
      };

      closeBtn.style.display = terminals.length > 0 ? "" : "none";
      tabsEl.insertBefore(tabEl, tabsEl.querySelector(".tab-add"));
      wrapperEl.appendChild(panelEl);
      terminals.push({
        term: t,
        fitAddon: fa,
        shell: state.shell,
        state,
        tabEl,
        panelEl,
      });

      if (terminals.length === 1) {
        t.focus();
      } else {
        switchTo(terminals.length - 1);
      }
    }

    const addBtn = document.createElement("button");
    addBtn.className = "tab-add";
    addBtn.textContent = "+";
    addBtn.onclick = () => addTerminal(true);
    addBtn.title = "New terminal";
    tabsEl.appendChild(addBtn);

    addTerminal(true);

    const apiTestEl = document.createElement("div");
    apiTestEl.style.cssText =
      "padding:8px 12px;background:#161b22;border-top:1px solid #30363d;font-size:12px;font-family:monospace";
    apiTestEl.innerHTML =
      '<span style="color:#8b949e">Test API: </span><button id="api-test-btn" style="padding:4px 10px;background:#21262d;color:#58a6ff;border:1px solid #30363d;border-radius:4px;cursor:pointer">GET /</button><pre id="api-test-out" style="margin-top:4px;color:#c9d1d9;white-space:pre-wrap"></pre>';
    wrapperEl.appendChild(apiTestEl);
    document.getElementById("api-test-btn")!.onclick = async () => {
      const out = document.getElementById("api-test-out")!;
      const port =
        (document.getElementById("preview-port") as HTMLSelectElement)?.value ||
        "5173";
      try {
        const r = await fetch(`/__port__/${port}/`);
        const t = await r.text();
        out.textContent = r.ok ? t : `HTTP ${r.status}\n${t}`;
        out.style.color = r.ok ? "#3fb950" : "#f85149";
      } catch (e) {
        out.textContent = (e as Error).message;
        out.style.color = "#f85149";
      }
    };

    const iframe = document.getElementById(
      "preview-iframe",
    ) as HTMLIFrameElement;
    const portSelect = document.getElementById(
      "preview-port",
    ) as HTMLSelectElement;
    const urlInput = document.getElementById("preview-url") as HTMLInputElement;
    const reloadBtn = document.getElementById("preview-reload")!;
    const statusEl = document.getElementById("preview-status")!;
    function getPath() {
      let p = (urlInput.value || "").trim();
      if (!p.startsWith("/")) p = "/" + p;
      return p || "/";
    }
    function loadPreview() {
      const port = portSelect.value;
      const path = getPath();
      const url = `/__port__/${port}${path}`;
      statusEl.textContent = "Loading...";
      iframe.src = url;
    }
    iframe.onload = () => {
      statusEl.textContent = "Ready";
      try {
        const loc = iframe.contentWindow?.location;
        if (loc) {
          const m = loc.pathname.match(/^\/__port__\/\d+(.*)$/);
          urlInput.value = m?.[1] || "/" || "/";
        }
      } catch {}
    };
    iframe.onerror = () => {
      statusEl.textContent = "Error loading";
    };
    portSelect.onchange = () => {
      urlInput.value = "/";
      loadPreview();
    };
    urlInput.onkeydown = (e) => {
      if (e.key === "Enter") loadPreview();
    };
    reloadBtn.onclick = loadPreview;
    loadPreview();
    window.addEventListener("port-registered", (e: Event) => {
      const port = (e as CustomEvent).detail?.port?.toString();
      if (!port) return;
      if (!Array.from(portSelect.options).some((o) => o.value === port)) {
        const opt = document.createElement("option");
        opt.value = port;
        opt.textContent = `:${port}`;
        portSelect.appendChild(opt);
      }
      portSelect.value = port;
      urlInput.value = "/";
      loadPreview();
    });
    window.addEventListener(
      "message",
      (e: MessageEvent<{ type?: string; cmd?: string }>) => {
        if (
          e.data?.type === "run-preview-cmd" &&
          e.data?.cmd &&
          terminals[activeIdx]
        ) {
          terminals[activeIdx].shell.execute(e.data.cmd);
        }
      },
    );
    wrapperEl.addEventListener("click", () => {
      if (terminals[activeIdx]) terminals[activeIdx].term.focus();
    });
    window.addEventListener("focus", () => {
      if (terminals[activeIdx]) terminals[activeIdx].term.focus();
    });
  } catch (e: unknown) {
    term.writeln("\x1b[31mError: " + ((e as Error)?.message ?? e) + "\x1b[0m");
    term.writeln("Press F5 to retry.");
    title.textContent = "Error: " + (e as Error).message;
    term.focus();
  }
}

init();
