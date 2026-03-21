/**
 * Parse node_modules path into package name and subpath.
 * Handles scoped packages (@org/pkg).
 */

export interface NodeModulesPath {
  pkgName: string
  subpath: string
}

export function parseNodeModulesPath(path: string): NodeModulesPath {
  const norm = path.replace(/\\/g, '/').replace(/\/+/g, '/')
  const match = norm.match(/node_modules\/((?:@[^/]+\/[^/]+)|[^/]+)\/(.+)/)
  if (!match) throw new Error(`Cannot parse node_modules path: ${path}`)
  return { pkgName: match[1]!, subpath: match[2]! }
}

export function isNodeModulesPath(path: string): boolean {
  return path.includes('/node_modules/')
}
