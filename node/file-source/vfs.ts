/**
 * VFSFileSource — reads files directly from VirtualFS.
 */

import type { VirtualFS } from '../vfs/core/vfs'
import type { FileSource } from './types'

export class VFSFileSource implements FileSource {
  constructor(private vfs: VirtualFS) {}

  async readFile(path: string, encoding?: 'utf8'): Promise<string | Uint8Array> {
    return this.vfs.readFile(path, encoding)
  }
}
