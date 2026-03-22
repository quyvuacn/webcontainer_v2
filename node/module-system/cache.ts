/**
 * Module cache — stores loaded modules by resolved path.
 */

import type { ModuleRecord } from "../types";

export class ModuleCache {
  private cache = new Map<string, ModuleRecord>();

  has(id: string): boolean {
    return this.cache.has(id);
  }

  get(id: string): ModuleRecord | undefined {
    return this.cache.get(id);
  }

  set(id: string, record: ModuleRecord): void {
    this.cache.set(id, record);
  }

  delete(id: string): boolean {
    return this.cache.delete(id);
  }

  clear(): void {
    this.cache.clear();
  }

  /** Invalidate when file changes (HMR). */
  invalidate(id: string): void {
    this.cache.delete(id);
  }

  /** Invalidate this module and all dependents. */
  invalidateDependents(id: string): void {
    const toRemove: string[] = [];
    for (const [cachedId, record] of this.cache) {
      if (cachedId === id || record.children.some((c) => c.id === id)) {
        toRemove.push(cachedId);
      }
    }
    for (const rid of toRemove) {
      this.cache.delete(rid);
    }
  }
}
