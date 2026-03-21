/**
 * Shared types for module system and sandbox.
 */

export interface ModuleRecord {
  id: string // absolute path in VFS
  exports: unknown
  loaded: boolean
  children: ModuleRecord[]
  filename: string
  dirname: string
}

export interface ResolveContext {
  callerPath: string
  extensions: string[]
  conditions: string[]
}

export interface TransformResult {
  code: string
  map?: string
  format: 'cjs' | 'esm'
}

// Message protocol between main thread and iframe
export type SandboxMessage =
  | { type: 'run'; payload: RunPayload }
  | { type: 'stdout'; payload: string }
  | { type: 'stderr'; payload: string }
  | { type: 'exit'; payload: number }
  | { type: 'fs-req'; payload: FsRequest }
  | { type: 'fs-res'; payload: FsResponse }
  | { type: 'fetch-req'; payload: FetchRequest }
  | { type: 'fetch-res'; payload: FetchResponse }
  | { type: 'error'; payload: string }

export interface RunPayload {
  file: string
  argv: string[]
  env: Record<string, string>
  cwd: string
}

export interface FsRequest {
  id: string
  op: string
  args: unknown[]
}

export interface FsResponse {
  id: string
  result?: unknown
  error?: string
}

export interface FetchRequest {
  id: string
  url: string
  options: RequestInit
}

export interface FetchResponse {
  id: string
  status: number
  headers: Record<string, string>
  body: ArrayBuffer
  error?: string
}
