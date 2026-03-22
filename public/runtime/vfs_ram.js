/* @ts-self-types="./vfs_ram.d.ts" */

/**
 * Acquire a write lock on `prefix`.
 *
 * While the lock is held:
 *   - Any fs.watch() event whose path starts with `prefix` is buffered.
 *   - Writes still go to RAM and OPFS immediately.
 *
 * Call `vfs_release_lock` when the batch write is complete. All buffered
 * events are flushed at that point.
 *
 * Returns a numeric LockId. Pass it to `vfs_release_lock`.
 * @param {string} prefix
 * @returns {bigint}
 */
export function vfs_acquire_lock(prefix) {
  const ptr0 = passStringToWasm0(
    prefix,
    wasm.__wbindgen_export2,
    wasm.__wbindgen_export3,
  );
  const len0 = WASM_VECTOR_LEN;
  const ret = wasm.vfs_acquire_lock(ptr0, len0);
  return BigInt.asUintN(64, ret);
}

/**
 * Delete `path`. Returns `true` if it existed.
 * @param {string} path
 * @returns {boolean}
 */
export function vfs_delete(path) {
  const ptr0 = passStringToWasm0(
    path,
    wasm.__wbindgen_export2,
    wasm.__wbindgen_export3,
  );
  const len0 = WASM_VECTOR_LEN;
  const ret = wasm.vfs_delete(ptr0, len0);
  return ret !== 0;
}

/**
 * Returns `true` if `path` exists (file or directory).
 * @param {string} path
 * @returns {boolean}
 */
export function vfs_exists(path) {
  const ptr0 = passStringToWasm0(
    path,
    wasm.__wbindgen_export2,
    wasm.__wbindgen_export3,
  );
  const len0 = WASM_VECTOR_LEN;
  const ret = wasm.vfs_exists(ptr0, len0);
  return ret !== 0;
}

/**
 * Remove `path` from the in-memory cache. The next read will return `null`,
 * prompting the caller to fetch fresh data from OPFS.
 * @param {string} path
 */
export function vfs_invalidate(path) {
  const ptr0 = passStringToWasm0(
    path,
    wasm.__wbindgen_export2,
    wasm.__wbindgen_export3,
  );
  const len0 = WASM_VECTOR_LEN;
  wasm.vfs_invalidate(ptr0, len0);
}

/**
 * Returns a JS Array of all file paths currently in RAM.
 * Useful for debugging and for generating the OPFS list during bootstrap.
 * @returns {Array<any>}
 */
export function vfs_list_all_paths() {
  const ret = wasm.vfs_list_all_paths();
  return takeObject(ret);
}

/**
 * Create directory `path` (and all ancestors).
 * @param {string} path
 */
export function vfs_mkdir(path) {
  const ptr0 = passStringToWasm0(
    path,
    wasm.__wbindgen_export2,
    wasm.__wbindgen_export3,
  );
  const len0 = WASM_VECTOR_LEN;
  wasm.vfs_mkdir(ptr0, len0);
}

/**
 * Write `content` to `path` without emitting watch events or triggering
 * OPFS write-through. Called during bootstrap to bulk-restore VFS from OPFS.
 * @param {string} path
 * @param {Uint8Array} content
 */
export function vfs_preload(path, content) {
  const ptr0 = passStringToWasm0(
    path,
    wasm.__wbindgen_export2,
    wasm.__wbindgen_export3,
  );
  const len0 = WASM_VECTOR_LEN;
  const ptr1 = passArray8ToWasm0(content, wasm.__wbindgen_export2);
  const len1 = WASM_VECTOR_LEN;
  wasm.vfs_preload(ptr0, len0, ptr1, len1);
}

/**
 * Read `path`. Returns `None` (JS `null`) if not found.
 * @param {string} path
 * @returns {Uint8Array | undefined}
 */
export function vfs_read(path) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      path,
      wasm.__wbindgen_export2,
      wasm.__wbindgen_export3,
    );
    const len0 = WASM_VECTOR_LEN;
    wasm.vfs_read(retptr, ptr0, len0);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    let v2;
    if (r0 !== 0) {
      v2 = getArrayU8FromWasm0(r0, r1).slice();
      wasm.__wbindgen_export4(r0, r1 * 1, 1);
    }
    return v2;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * List direct children of `dir_path`.
 * Returns a JS Array of strings (names, not full paths).
 * @param {string} dir_path
 * @returns {Array<any>}
 */
export function vfs_readdir(dir_path) {
  const ptr0 = passStringToWasm0(
    dir_path,
    wasm.__wbindgen_export2,
    wasm.__wbindgen_export3,
  );
  const len0 = WASM_VECTOR_LEN;
  const ret = wasm.vfs_readdir(ptr0, len0);
  return takeObject(ret);
}

/**
 * Release a write lock and flush all buffered watch events.
 * @param {bigint} id
 */
export function vfs_release_lock(id) {
  wasm.vfs_release_lock(id);
}

/**
 * Remove all files under `prefix` (including `prefix` itself if it is a file).
 * @param {string} prefix
 */
export function vfs_remove_prefix(prefix) {
  const ptr0 = passStringToWasm0(
    prefix,
    wasm.__wbindgen_export2,
    wasm.__wbindgen_export3,
  );
  const len0 = WASM_VECTOR_LEN;
  wasm.vfs_remove_prefix(ptr0, len0);
}

/**
 * Called once by JS (WasmVfsAdapter) after WASM init.
 * `write_fn(path: string, bytes: Uint8Array) → void`
 * `delete_fn(path: string) → void`
 * @param {Function} write_fn
 * @param {Function} delete_fn
 */
export function vfs_set_opfs_callbacks(write_fn, delete_fn) {
  wasm.vfs_set_opfs_callbacks(
    addHeapObject(write_fn),
    addHeapObject(delete_fn),
  );
}

/**
 * Stat `path`. Returns a JS object `{ size, mtime, is_file, is_dir }`,
 * or `null` if the path does not exist.
 * @param {string} path
 * @returns {any}
 */
export function vfs_stat(path) {
  const ptr0 = passStringToWasm0(
    path,
    wasm.__wbindgen_export2,
    wasm.__wbindgen_export3,
  );
  const len0 = WASM_VECTOR_LEN;
  const ret = wasm.vfs_stat(ptr0, len0);
  return takeObject(ret);
}

/**
 * Remove the watcher with the given id. Returns `true` if found.
 * @param {bigint} id
 * @returns {boolean}
 */
export function vfs_unwatch(id) {
  const ret = wasm.vfs_unwatch(id);
  return ret !== 0;
}

/**
 * Register a watcher on `path`.
 *
 * `callback` is called synchronously on every write/delete that matches,
 * with `{ path: string, kind: "created" | "modified" | "deleted" }`.
 *
 * Returns a numeric WatcherId. Pass it to `vfs_unwatch` to remove.
 * @param {string} path
 * @param {boolean} recursive
 * @param {Function} callback
 * @returns {bigint}
 */
export function vfs_watch(path, recursive, callback) {
  const ptr0 = passStringToWasm0(
    path,
    wasm.__wbindgen_export2,
    wasm.__wbindgen_export3,
  );
  const len0 = WASM_VECTOR_LEN;
  const ret = wasm.vfs_watch(ptr0, len0, recursive, addHeapObject(callback));
  return BigInt.asUintN(64, ret);
}

/**
 * Write `content` bytes to `path`.
 *
 * Triggers:
 *   - RAM update (sync)
 *   - fs.watch() events (sync, possibly deferred if path is locked)
 *   - OPFS write-through (async, fire-and-forget)
 * @param {string} path
 * @param {Uint8Array} content
 */
export function vfs_write(path, content) {
  const ptr0 = passStringToWasm0(
    path,
    wasm.__wbindgen_export2,
    wasm.__wbindgen_export3,
  );
  const len0 = WASM_VECTOR_LEN;
  const ptr1 = passArray8ToWasm0(content, wasm.__wbindgen_export2);
  const len1 = WASM_VECTOR_LEN;
  wasm.vfs_write(ptr0, len0, ptr1, len1);
}

function __wbg_get_imports() {
  const import0 = {
    __proto__: null,
    __wbg_Error_83742b46f01ce22d: function (arg0, arg1) {
      const ret = Error(getStringFromWasm0(arg0, arg1));
      return addHeapObject(ret);
    },
    __wbg___wbindgen_throw_6ddd609b62940d55: function (arg0, arg1) {
      throw new Error(getStringFromWasm0(arg0, arg1));
    },
    __wbg_call_2d781c1f4d5c0ef8: function () {
      return handleError(function (arg0, arg1, arg2) {
        const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_call_dcc2662fa17a72cf: function () {
      return handleError(function (arg0, arg1, arg2, arg3) {
        const ret = getObject(arg0).call(
          getObject(arg1),
          getObject(arg2),
          getObject(arg3),
        );
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_new_a70fbab9066b301f: function () {
      const ret = new Array();
      return addHeapObject(ret);
    },
    __wbg_new_ab79df5bd7c26067: function () {
      const ret = new Object();
      return addHeapObject(ret);
    },
    __wbg_new_from_slice_22da9388ac046e50: function (arg0, arg1) {
      const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
      return addHeapObject(ret);
    },
    __wbg_now_16f0c993d5dd6c27: function () {
      const ret = Date.now();
      return ret;
    },
    __wbg_push_e87b0e732085a946: function (arg0, arg1) {
      const ret = getObject(arg0).push(getObject(arg1));
      return ret;
    },
    __wbg_set_6be42768c690e380: function (arg0, arg1, arg2) {
      getObject(arg0)[takeObject(arg1)] = takeObject(arg2);
    },
    __wbg_set_7eaa4f96924fd6b3: function () {
      return handleError(function (arg0, arg1, arg2) {
        const ret = Reflect.set(
          getObject(arg0),
          getObject(arg1),
          getObject(arg2),
        );
        return ret;
      }, arguments);
    },
    __wbindgen_cast_0000000000000001: function (arg0) {
      // Cast intrinsic for `F64 -> Externref`.
      const ret = arg0;
      return addHeapObject(ret);
    },
    __wbindgen_cast_0000000000000002: function (arg0, arg1) {
      // Cast intrinsic for `Ref(String) -> Externref`.
      const ret = getStringFromWasm0(arg0, arg1);
      return addHeapObject(ret);
    },
    __wbindgen_cast_0000000000000003: function (arg0) {
      // Cast intrinsic for `U64 -> Externref`.
      const ret = BigInt.asUintN(64, arg0);
      return addHeapObject(ret);
    },
    __wbindgen_object_clone_ref: function (arg0) {
      const ret = getObject(arg0);
      return addHeapObject(ret);
    },
    __wbindgen_object_drop_ref: function (arg0) {
      takeObject(arg0);
    },
  };
  return {
    __proto__: null,
    "./vfs_ram_bg.js": import0,
  };
}

function addHeapObject(obj) {
  if (heap_next === heap.length) heap.push(heap.length + 1);
  const idx = heap_next;
  heap_next = heap[idx];

  heap[idx] = obj;
  return idx;
}

function dropObject(idx) {
  if (idx < 1028) return;
  heap[idx] = heap_next;
  heap_next = idx;
}

function getArrayU8FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
  if (
    cachedDataViewMemory0 === null ||
    cachedDataViewMemory0.buffer.detached === true ||
    (cachedDataViewMemory0.buffer.detached === undefined &&
      cachedDataViewMemory0.buffer !== wasm.memory.buffer)
  ) {
    cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
  }
  return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
  if (
    cachedUint8ArrayMemory0 === null ||
    cachedUint8ArrayMemory0.byteLength === 0
  ) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}

function getObject(idx) {
  return heap[idx];
}

function handleError(f, args) {
  try {
    return f.apply(this, args);
  } catch (e) {
    wasm.__wbindgen_export(addHeapObject(e));
  }
}

let heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function passArray8ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 1, 1) >>> 0;
  getUint8ArrayMemory0().set(arg, ptr / 1);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === undefined) {
    const buf = cachedTextEncoder.encode(arg);
    const ptr = malloc(buf.length, 1) >>> 0;
    getUint8ArrayMemory0()
      .subarray(ptr, ptr + buf.length)
      .set(buf);
    WASM_VECTOR_LEN = buf.length;
    return ptr;
  }

  let len = arg.length;
  let ptr = malloc(len, 1) >>> 0;

  const mem = getUint8ArrayMemory0();

  let offset = 0;

  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 0x7f) break;
    mem[ptr + offset] = code;
  }
  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset);
    }
    ptr = realloc(ptr, len, (len = offset + arg.length * 3), 1) >>> 0;
    const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
    const ret = cachedTextEncoder.encodeInto(arg, view);

    offset += ret.written;
    ptr = realloc(ptr, len, offset, 1) >>> 0;
  }

  WASM_VECTOR_LEN = offset;
  return ptr;
}

function takeObject(idx) {
  const ret = getObject(idx);
  dropObject(idx);
  return ret;
}

let cachedTextDecoder = new TextDecoder("utf-8", {
  ignoreBOM: true,
  fatal: true,
});
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
  numBytesDecoded += len;
  if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
    cachedTextDecoder = new TextDecoder("utf-8", {
      ignoreBOM: true,
      fatal: true,
    });
    cachedTextDecoder.decode();
    numBytesDecoded = len;
  }
  return cachedTextDecoder.decode(
    getUint8ArrayMemory0().subarray(ptr, ptr + len),
  );
}

const cachedTextEncoder = new TextEncoder();

if (!("encodeInto" in cachedTextEncoder)) {
  cachedTextEncoder.encodeInto = function (arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
      read: arg.length,
      written: buf.length,
    };
  };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
  wasm = instance.exports;
  wasmModule = module;
  cachedDataViewMemory0 = null;
  cachedUint8ArrayMemory0 = null;
  return wasm;
}

async function __wbg_load(module, imports) {
  if (typeof Response === "function" && module instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === "function") {
      try {
        return await WebAssembly.instantiateStreaming(module, imports);
      } catch (e) {
        const validResponse = module.ok && expectedResponseType(module.type);

        if (
          validResponse &&
          module.headers.get("Content-Type") !== "application/wasm"
        ) {
          console.warn(
            "`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n",
            e,
          );
        } else {
          throw e;
        }
      }
    }

    const bytes = await module.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    const instance = await WebAssembly.instantiate(module, imports);

    if (instance instanceof WebAssembly.Instance) {
      return { instance, module };
    } else {
      return instance;
    }
  }

  function expectedResponseType(type) {
    switch (type) {
      case "basic":
      case "cors":
      case "default":
        return true;
    }
    return false;
  }
}

function initSync(module) {
  if (wasm !== undefined) return wasm;

  if (module !== undefined) {
    if (Object.getPrototypeOf(module) === Object.prototype) {
      ({ module } = module);
    } else {
      console.warn(
        "using deprecated parameters for `initSync()`; pass a single object instead",
      );
    }
  }

  const imports = __wbg_get_imports();
  if (!(module instanceof WebAssembly.Module)) {
    module = new WebAssembly.Module(module);
  }
  const instance = new WebAssembly.Instance(module, imports);
  return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
  if (wasm !== undefined) return wasm;

  if (module_or_path !== undefined) {
    if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
      ({ module_or_path } = module_or_path);
    } else {
      console.warn(
        "using deprecated parameters for the initialization function; pass a single object instead",
      );
    }
  }

  if (module_or_path === undefined) {
    module_or_path = new URL("vfs_ram_bg.wasm", import.meta.url);
  }
  const imports = __wbg_get_imports();

  if (
    typeof module_or_path === "string" ||
    (typeof Request === "function" && module_or_path instanceof Request) ||
    (typeof URL === "function" && module_or_path instanceof URL)
  ) {
    module_or_path = fetch(module_or_path);
  }

  const { instance, module } = await __wbg_load(await module_or_path, imports);

  return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
