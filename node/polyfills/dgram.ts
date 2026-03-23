/**
 * Node dgram polyfill — UDP sockets. Not available in browser.
 * Stub to prevent crashes in packages that optionally require dgram.
 */

import EventEmitter from "eventemitter3";

class Socket extends EventEmitter {
  type: "udp4" | "udp6";

  constructor(type: "udp4" | "udp6") {
    super();
    this.type = type;
  }

  bind(
    _portOrOptions?: unknown,
    _addressOrCb?: unknown,
    _cb?: unknown,
  ): this {
    setTimeout(() => this.emit("listening"), 0);
    return this;
  }

  send(
    _msg: unknown,
    _offsetOrPort?: unknown,
    _lengthOrAddress?: unknown,
    _portOrCb?: unknown,
    _addressOrCb?: unknown,
    _cb?: unknown,
  ): void {}

  close(_cb?: () => void): void {
    if (_cb) setTimeout(_cb, 0);
    this.emit("close");
  }

  address(): { address: string; family: string; port: number } {
    return { address: "0.0.0.0", family: "IPv4", port: 0 };
  }

  addMembership(_multicastAddr: string, _interfaceAddr?: string): void {}
  dropMembership(_multicastAddr: string, _interfaceAddr?: string): void {}
  setMulticastTTL(_ttl: number): void {}
  setMulticastLoopback(_flag: boolean): void {}
  setTTL(_ttl: number): void {}
  setBroadcast(_flag: boolean): void {}
  setRecvBufferSize(_size: number): void {}
  setSendBufferSize(_size: number): void {}
  getRecvBufferSize(): number { return 0; }
  getSendBufferSize(): number { return 0; }
  ref(): this { return this; }
  unref(): this { return this; }
}

function createSocket(
  typeOrOptions: "udp4" | "udp6" | { type: "udp4" | "udp6" },
  _cb?: unknown,
): Socket {
  const type =
    typeof typeOrOptions === "string" ? typeOrOptions : typeOrOptions.type;
  return new Socket(type);
}

export function createDgramPolyfill(): Record<string, unknown> {
  return {
    Socket,
    createSocket,
  };
}
