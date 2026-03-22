let opfsWorker: Worker | null = null;
const pending = new Map<string, (data: unknown) => void>();

export function initOpfsBridge(workerUrl: string | URL) {
  if (opfsWorker) return;
  opfsWorker = new Worker(workerUrl, { type: "module" });
  opfsWorker.onmessage = ({ data }: MessageEvent<{ id: string }>) => {
    const resolve = pending.get(data.id);
    if (resolve) {
      pending.delete(data.id);
      resolve(data);
    }
  };
}

function send(op: Record<string, unknown>): Promise<{ err?: string }> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    pending.set(id, (data: { err?: string }) => {
      if (data.err) reject(new Error(data.err));
      else resolve(data);
    });
    opfsWorker!.postMessage({ ...op, id });
  });
}

export function opfsWrite(path: string, bytes: Uint8Array) {
  return send({ op: "write", path, bytes });
}

export function opfsRead(path: string) {
  return send({ op: "read", path }).then(
    (d: { content?: Uint8Array }) => d.content,
  );
}

export function opfsListAll() {
  return send({ op: "list_all" }).then(
    (d: { files?: { path: string; content: Uint8Array }[] }) => d.files || [],
  );
}

export function opfsDelete(path: string) {
  return send({ op: "delete", path });
}

export function createBroadcastChannel(callback: (path: string) => void) {
  const bc = new BroadcastChannel("vfs_opfs_sync");
  bc.onmessage = ({ data }: MessageEvent<{ type: string; path?: string }>) => {
    if (data.type === "file_changed") callback(data.path!);
  };
  return bc;
}
