/**
 * TypeScript/TSX/JSX → JS transform using esbuild-wasm.
 */

import * as esbuild from "esbuild-wasm";
import type { TransformResult } from "../types";
import { detectLoader } from "./detect";
import { safeTransform } from "./esm-to-cjs";

export class TypeScriptTransformer {
  async transform(
    code: string,
    filePath: string,
    format: "cjs" | "esm",
    tsconfigRaw?: string,
  ): Promise<TransformResult> {
    const loader = detectLoader(filePath) as esbuild.Loader;
    const result = await safeTransform(code, {
      loader,
      format,
      target: "esnext",
      sourcemap: "inline",
      ...(tsconfigRaw && { tsconfigRaw }),
    });

    return {
      code: result.code,
      map: result.map ?? undefined,
      format,
    };
  }
}
