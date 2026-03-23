/**
 * SharedArrayBuffer layout for the virtual TCP protocol.
 *
 * Layout (per SAB):
 *   [0] Int32 — state: 0=idle, 1=request_ready, 2=response_ready
 *   [1] Int32 — request length in bytes
 *   [2] Int32 — response length in bytes
 *   [12..] Uint8 — payload: request bytes followed by response bytes
 */
export const SAB_CTRL_SLOTS = 3;
export const DATA_OFF = SAB_CTRL_SLOTS * 4; // 12 bytes
export const SAB_SIZE = 4 * 1024 * 1024;    // 4 MB
