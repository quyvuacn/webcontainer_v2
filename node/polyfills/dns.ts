/**
 * Node dns polyfill — minimal implementation for browser.
 * lookup() is the main function used by dev servers to resolve 'localhost'.
 */

type LookupCallback = (
  err: Error | null,
  address: string,
  family: number,
) => void;
type LookupOptions = { family?: number; all?: boolean };

// Known loopback/special hostnames — resolve without real DNS
const KNOWN: Record<string, { address: string; family: number }> = {
  localhost: { address: "127.0.0.1", family: 4 },
  "127.0.0.1": { address: "127.0.0.1", family: 4 },
  "::1": { address: "::1", family: 6 },
  "0.0.0.0": { address: "0.0.0.0", family: 4 },
  "::": { address: "::", family: 6 },
};

function lookupImpl(
  hostname: string,
  options: LookupOptions | number | LookupCallback | null,
  callback?: LookupCallback,
): void {
  let cb: LookupCallback;
  let opts: LookupOptions = {};

  if (typeof options === "function") {
    cb = options;
    opts = {};
  } else if (typeof callback === "function") {
    cb = callback;
    if (typeof options === "number") opts = { family: options };
    else if (options) opts = options as LookupOptions;
  } else {
    return;
  }

  const known = KNOWN[hostname];
  if (known) {
    if (opts.all) {
      // all=true returns array; callback receives (err, addresses)
      (
        cb as unknown as (
          err: null,
          addrs: Array<{ address: string; family: number }>,
        ) => void
      )(null, [known]);
    } else {
      cb(null, known.address, known.family);
    }
  } else {
    // Unknown hostname — return as-is (assume IP or resolvable)
    cb(null, hostname, hostname.includes(":") ? 6 : 4);
  }
}

async function lookupPromise(
  hostname: string,
  options?: LookupOptions | number,
): Promise<
  | { address: string; family: number }
  | Array<{ address: string; family: number }>
> {
  return new Promise((resolve, reject) => {
    lookupImpl(hostname, options ?? {}, (err, address, family) => {
      if (err) reject(err);
      else if (typeof options === "object" && options?.all)
        resolve([{ address, family }]);
      else resolve({ address, family });
    });
  });
}

const stubPromise = () => Promise.resolve([]);

export function createDnsPolyfill(): Record<string, unknown> {
  return {
    lookup: lookupImpl,
    lookupService: (
      _addr: string,
      _port: number,
      cb: (err: Error | null, hostname: string, service: string) => void,
    ) => cb(null, "localhost", "http"),
    resolve: stubPromise,
    resolve4: stubPromise,
    resolve6: stubPromise,
    resolveAny: stubPromise,
    resolveCname: stubPromise,
    resolveMx: stubPromise,
    resolveNaptr: stubPromise,
    resolveNs: stubPromise,
    resolvePtr: stubPromise,
    resolveSoa: stubPromise,
    resolveSrv: stubPromise,
    resolveTxt: stubPromise,
    reverse: stubPromise,
    setServers: () => {},
    getServers: () => [],
    NODATA: "ENODATA",
    FORMERR: "EFORMERR",
    SERVFAIL: "ESERVFAIL",
    NOTFOUND: "ENOTFOUND",
    NOTIMP: "ENOTIMP",
    REFUSED: "EREFUSED",
    BADQUERY: "EBADQUERY",
    promises: {
      lookup: lookupPromise,
      lookupService: (addr: string, _port: number) =>
        Promise.resolve({ hostname: addr, service: "http" }),
      resolve: stubPromise,
      resolve4: stubPromise,
      resolve6: stubPromise,
      resolveAny: stubPromise,
      resolveCname: stubPromise,
      resolveMx: stubPromise,
      resolveNaptr: stubPromise,
      resolveNs: stubPromise,
      resolvePtr: stubPromise,
      resolveSoa: stubPromise,
      resolveSrv: stubPromise,
      resolveTxt: stubPromise,
      reverse: stubPromise,
      setServers: () => {},
      getServers: () => [],
    },
  };
}
