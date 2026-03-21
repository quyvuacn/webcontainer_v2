/**
 * FileSource — abstraction for reading files from VFS or server.
 */

export interface FileSource {
  readFile(path: string, encoding?: 'utf8'): Promise<string | Uint8Array>
}
