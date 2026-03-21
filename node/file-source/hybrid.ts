/**
 * HybridFileSource — reads project files from VFS, node_modules from server.
 */

import type { VirtualFS } from '../vfs/core/vfs'
import type { FileSource } from './types'
import { parseNodeModulesPath, isNodeModulesPath } from './parse-path'
import { installGate } from '../install-gate'

export class HybridFileSource implements FileSource {
  constructor(
    private vfs: VirtualFS,
    private serverBase: string,
    private sessionId: string,
  ) {}

  async readFile(path: string, encoding?: 'utf8'): Promise<string | Uint8Array> {
    await installGate.wait()

    if (!isNodeModulesPath(path)) {
      return this.vfs.readFile(path, encoding)
    }

    const { pkgName, subpath } = parseNodeModulesPath(path)
    const version = await this.getVersion(pkgName, path)

    const url = new URL(`${this.serverBase}/api/packages`)
    url.searchParams.set('session', this.sessionId)
    url.searchParams.set('name', pkgName)
    url.searchParams.set('version', version)
    url.searchParams.set('path', subpath)

    const res = await fetch(url.toString())

    if (res.status === 503) {
      return this.retryWithBackoff(() => this.readFile(path, encoding))
    }

    if (!res.ok) {
      throw new Error(`Server fetch failed [${res.status}]: ${pkgName}/${subpath}`)
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (encoding === 'utf8' || contentType.startsWith('text/') || contentType.includes('javascript')) {
      return res.text()
    }
    return new Uint8Array(await res.arrayBuffer())
  }

  private async getVersion(pkgName: string, fromPath: string): Promise<string> {
    const nmIdx = fromPath.indexOf('/node_modules/')
    const before = nmIdx >= 0 ? fromPath.slice(0, nmIdx) : '/project'
    const pkgJsonPath = (before.startsWith('/') ? '' : '/') + before + '/node_modules/' + pkgName + '/package.json'
    const raw = (await this.vfs.readFile(pkgJsonPath, 'utf8')) as string
    const pkg = JSON.parse(raw) as { version?: string }
    if (!pkg.version) throw new Error(`No version in ${pkgJsonPath}`)
    return pkg.version
  }

  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries = 5,
    delayMs = 300,
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, i)))
      try {
        return await fn()
      } catch {
        // continue
      }
    }
    throw new Error('Max retries exceeded waiting for server install')
  }
}
