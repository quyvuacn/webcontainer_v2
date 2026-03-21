/**
 * Node os module polyfill — fake Linux-like values for browser.
 */

export function createOsPolyfill() {
  return {
    platform: (): NodeJS.Platform => 'linux',
    arch: (): string => 'x64',
    type: (): string => 'Linux',
    release: (): string => '5.15.0',
    version: (): string => '#1 SMP',
    homedir: (): string => '/home/user',
    tmpdir: (): string => '/tmp',
    hostname: (): string => 'browser',
    endianness: (): 'BE' | 'LE' => 'LE',
    loadavg: (): [number, number, number] => [0, 0, 0],
    availableParallelism: (): number =>
      (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4,

    cpus: () => Array.from({ length: 4 }, () => ({
      model: 'Browser vCPU',
      speed: 2400,
      times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
    })),

    totalmem: (): number => 8 * 1024 * 1024 * 1024,
    freemem: (): number => 4 * 1024 * 1024 * 1024,
    uptime: (): number => performance.now() / 1000,

    networkInterfaces: (): Record<string, unknown[]> => ({
      lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true }],
    }),

    userInfo: (_options?: { encoding?: string }) => ({
      username: 'user',
      uid: 1000,
      gid: 1000,
      shell: '/bin/sh',
      homedir: '/home/user',
    }),

    getPriority: (_pid?: number): number => 0,
    setPriority: (_pidOrPriority: number, _priority?: number): void => {},

    EOL: '\n',

    constants: {
      signals: {
        SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGILL: 4, SIGTRAP: 5,
        SIGABRT: 6, SIGBUS: 7, SIGFPE: 8, SIGKILL: 9, SIGUSR1: 10,
        SIGSEGV: 11, SIGUSR2: 12, SIGPIPE: 13, SIGALRM: 14, SIGTERM: 15,
        SIGCHLD: 17, SIGCONT: 18, SIGSTOP: 19, SIGTSTP: 20, SIGTTIN: 21,
        SIGTTOU: 22, SIGURG: 23, SIGXCPU: 24, SIGXFSZ: 25, SIGVTALRM: 26,
        SIGPROF: 27, SIGWINCH: 28, SIGIO: 29, SIGPWR: 30, SIGSYS: 31,
      } as Record<string, number>,
      errno: {
        EPERM: 1, ENOENT: 2, ESRCH: 3, EINTR: 4, EIO: 5,
        ENXIO: 6, E2BIG: 7, ENOEXEC: 8, EBADF: 9, ECHILD: 10,
        EAGAIN: 11, ENOMEM: 12, EACCES: 13, EFAULT: 14, EBUSY: 16,
        EEXIST: 17, EXDEV: 18, ENODEV: 19, ENOTDIR: 20, EISDIR: 21,
        EINVAL: 22, ENFILE: 23, EMFILE: 24, ENOTTY: 25, EFBIG: 27,
        ENOSPC: 28, ESPIPE: 29, EROFS: 30, EMLINK: 31, EPIPE: 32,
        EDOM: 33, ERANGE: 34, EDEADLK: 35, ENAMETOOLONG: 36, ENOLCK: 37,
        ENOSYS: 38, ENOTEMPTY: 39, ELOOP: 40, EWOULDBLOCK: 11, ENOMSG: 42,
        EIDRM: 43, ENOSTR: 60, ENODATA: 61, ETIME: 62, ENOSR: 63,
        EREMOTE: 66, ENOLINK: 67, EPROTO: 71, EMULTIHOP: 72, EBADMSG: 74,
        EOVERFLOW: 75, EILSEQ: 84, EUSERS: 87, ENOTSOCK: 88, EDESTADDRREQ: 89,
        EMSGSIZE: 90, EPROTOTYPE: 91, ENOPROTOOPT: 92, EPROTONOSUPPORT: 93,
        ESOCKTNOSUPPORT: 94, EOPNOTSUPP: 95, EPFNOSUPPORT: 96, EAFNOSUPPORT: 97,
        EADDRINUSE: 98, EADDRNOTAVAIL: 99, ENETDOWN: 100, ENETUNREACH: 101,
        ENETRESET: 102, ECONNABORTED: 103, ECONNRESET: 104, ENOBUFS: 105,
        EISCONN: 106, ENOTCONN: 107, ESHUTDOWN: 108, ETOOMANYREFS: 109,
        ETIMEDOUT: 110, ECONNREFUSED: 111, EHOSTDOWN: 112, EHOSTUNREACH: 113,
        EALREADY: 114, EINPROGRESS: 115, ESTALE: 116, ECANCELED: 125,
      } as Record<string, number>,
      priority: {
        PRIORITY_LOW: 19, PRIORITY_BELOW_NORMAL: 10, PRIORITY_NORMAL: 0,
        PRIORITY_ABOVE_NORMAL: -7, PRIORITY_HIGH: -14, PRIORITY_HIGHEST: -20,
      } as Record<string, number>,
      UV_UDP_REUSEADDR: 4,
    },
  }
}
