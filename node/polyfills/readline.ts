/**
 * Node readline polyfill — cursorTo, clearScreenDown for CAC/picocolors.
 * Delegates to stream.cursorTo / stream.clearScreenDown.
 */

type StreamLike = {
  cursorTo?: (x: number, y?: number, cb?: () => void) => boolean;
  clearScreenDown?: (cb?: () => void) => boolean;
};

function cursorTo(
  stream: StreamLike,
  x: number,
  y?: number,
  cb?: () => void,
): boolean {
  if (stream?.cursorTo) return stream.cursorTo(x, y, cb);
  cb?.();
  return true;
}

function clearScreenDown(stream: StreamLike, cb?: () => void): boolean {
  if (stream?.clearScreenDown) return stream.clearScreenDown(cb);
  cb?.();
  return true;
}

export function createReadlinePolyfill() {
  return {
    cursorTo,
    clearScreenDown,
    createInterface: () => ({ close: () => {} }),
  };
}
