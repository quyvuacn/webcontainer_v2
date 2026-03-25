/**
 * Node vm polyfill — stub for browser.
 * Supports runInNewContext / runInThisContext / runInContext / Script / createContext.
 * Full VM sandboxing is not possible in browser; code runs in the current realm.
 */

class Script {
  private code: string;
  private filename: string;

  constructor(code: string, options?: { filename?: string }) {
    this.code = code;
    this.filename = options?.filename ?? "<script>";
  }

  runInNewContext(sandbox?: Record<string, unknown>): unknown {
    return runInNewContext(this.code, sandbox);
  }

  runInThisContext(): unknown {
    return runInThisContext(this.code);
  }

  runInContext(
    context: Record<string, unknown>,
    _options?: Record<string, unknown>,
  ): unknown {
    return runInNewContext(this.code, context);
  }
}

function createContext(
  sandbox: Record<string, unknown> = {},
): Record<string, unknown> {
  // In browser we can't create a real isolated context; return sandbox as-is
  return Object.assign(Object.create(null), sandbox);
}

function isContext(obj: unknown): boolean {
  // No real context tracking in browser — return true for plain objects
  return obj !== null && typeof obj === "object";
}

function runInNewContext(
  code: string,
  sandbox?: Record<string, unknown>,
  _options?: Record<string, unknown>,
): unknown {
  const ctx = sandbox ?? {};

  // Use with() so that:
  //   1. Sandbox properties are visible as bare names inside code.
  //   2. Assignments like `x = 42` write through to the ctx object (since
  //      with() makes ctx the head of the scope chain in non-strict mode).
  // This matches Node.js vm.runInNewContext where sandbox IS the global context.
  //
  // We embed the code string via JSON.stringify to safely pass arbitrary code
  // across the string boundary, then eval it inside the with block so the
  // scope chain includes ctx.
  const escapedCode = JSON.stringify(code);
  // Two-pass: try expression form first so bare expressions return a value,
  // then fall back to statement form.
  const wrapperSrc = `(function(__ctx__) {
    with (__ctx__) {
      try { return eval("(" + ${escapedCode} + ")"); }
      catch(_e1) {
        return eval(${escapedCode});
      }
    }
  })`;

  let fn: ((ctx: Record<string, unknown>) => unknown) | null = null;
  try {
    // eslint-disable-next-line no-new-func
    fn = new Function(`return ${wrapperSrc}`)() as (ctx: Record<string, unknown>) => unknown;
  } catch (e) {
    throw e;
  }
  return fn!(ctx);
}

function runInThisContext(
  code: string,
  _options?: Record<string, unknown>,
): unknown {
  try {
    // eslint-disable-next-line no-new-func
    return new Function(`"use strict"; return (${code})`)();
  } catch {
    // eslint-disable-next-line no-new-func
    return new Function(code)();
  }
}

function runInContext(
  code: string,
  context: Record<string, unknown>,
  options?: Record<string, unknown>,
): unknown {
  return runInNewContext(code, context, options);
}

function compileFunction(
  code: string,
  params: string[] = [],
  _options?: Record<string, unknown>,
): (...args: unknown[]) => unknown {
  // eslint-disable-next-line no-new-func
  return new Function(...params, code) as (...args: unknown[]) => unknown;
}

function measureMemory(): Promise<{ total: { jsMemoryEstimate: number } }> {
  return Promise.resolve({ total: { jsMemoryEstimate: 0 } });
}

export function createVmPolyfill(): Record<string, unknown> {
  return {
    Script,
    createContext,
    isContext,
    runInNewContext,
    runInThisContext,
    runInContext,
    compileFunction,
    measureMemory,
    constants: {
      USE_MAIN_CONTEXT_DEFAULT_LOADER: 0,
    },
  };
}
