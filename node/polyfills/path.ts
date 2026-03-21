/**
 * Node path module polyfill — posix style for browser (always /).
 */

import { PathUtils } from '../vfs/core/path'

export const path = {
  sep: '/',
  delimiter: ':',

  normalize: (p: string) => PathUtils.normalize(p),
  join: (...args: string[]) => PathUtils.join(...args),
  resolve: (...args: string[]) => PathUtils.resolve(...args),
  dirname: (p: string) => PathUtils.dirname(p),
  basename: (p: string, ext?: string) => PathUtils.basename(p, ext),
  extname: (p: string) => PathUtils.extname(p),
  isAbsolute: (p: string) => PathUtils.isAbsolute(p),

  relative: (from: string, to: string): string => {
    const fromParts = PathUtils.split(PathUtils.normalize(from))
    const toParts = PathUtils.split(PathUtils.normalize(to))
    let i = 0
    while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
      i++
    }
    const ups = fromParts.length - i
    const downs = toParts.slice(i)
    const result = [...Array(ups).fill('..'), ...downs].join('/')
    return result || '.'
  },

}

// posix/win32 for compatibility (both use posix in browser)
;(path as Record<string, unknown>).posix = path
;(path as Record<string, unknown>).win32 = path
