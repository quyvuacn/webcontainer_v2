/**
 * TypeScript/TSX/JSX → JS transform using esbuild-wasm.
 */

import * as esbuild from 'esbuild-wasm'
import type { TransformResult } from '../types'
import { detectLoader } from './detect'
import { safeTransform } from './esm-to-cjs'

export class TypeScriptTransformer {
  async transform(
    code: string,
    filePath: string,
    format: 'cjs' | 'esm',
  ): Promise<TransformResult> {
    const loader = detectLoader(filePath) as esbuild.Loader
    const result = await safeTransform(code, {
      loader,
      format,
      target: 'es2022',
      sourcemap: 'inline',
    })

    return {
      code: result.code,
      map: result.map ?? undefined,
      format,
    }
  }
}
