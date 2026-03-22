export interface PackageJson {
  name?: string;
  version?: string;
  main?: string;
  module?: string;
  type?: string;
  exports?: Record<
    string,
    string | { require?: string; import?: string; default?: string }
  >;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export function parsePackageJson(content: string): PackageJson | null {
  try {
    return JSON.parse(content) as PackageJson;
  } catch {
    return null;
  }
}
