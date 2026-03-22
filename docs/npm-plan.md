# WebContainer + Proxy Server — Implementation Plan

## Tổng quan hệ thống

```
Client (browser)                    Proxy Server (Node)
─────────────────                   ───────────────────
VFS (in-memory)                     npm registry
Bundler (esbuild-wasm)              tarball cache
Resolver                            lockfile generator
Lazy fetcher
```

---

## Module 1 — Proxy Server

### Endpoint 1: `POST /resolve`

Nhận `package.json`, trả `package-lock.json`.

```
1. hash(body) → check disk cache
2. cache hit  → trả ngay
3. cache miss →
   a. mkdir tmp/<hash>/
   b. write package.json
   c. npm install --package-lock-only --ignore-scripts --prefer-offline
   d. đọc package-lock.json
   e. write cache/<hash>/package-lock.json
   f. rm -rf tmp/<hash>/
   g. trả về client
```

Cache key là hash của toàn bộ `package.json` content. Cùng dependencies → không chạy npm lại.

### Endpoint 2: `GET /:pkg@:version/:filepath`

Đã có — serve file từ tarball cache. Giữ nguyên.

### Endpoint 3: `GET /registry/:pkg`

Đã có — forward packument từ npm registry. Giữ nguyên.

---

## Module 2 — VersionMap Builder

Đọc lockfile, output map từ VFS path prefix → version. Phải handle **cả hai format**:

```
lockfileVersion 1   → dùng "dependencies" (lồng nhau)
lockfileVersion 2/3 → dùng "packages" (flat, key là path)
```

```ts
// v3 format — packages là flat map
{
  "node_modules/vite": { version: "6.0.0" },
  "node_modules/vite/node_modules/rollup": { version: "4.0.0" }
}

// output versionMap:
{
  "node_modules/vite": "6.0.0",
  "node_modules/vite/node_modules/rollup": "4.0.0"
}
```

Với v1 (lồng nhau), walk đệ quy `dependencies` và reconstruct path.

VersionMap là input cho Resolver và Lazy Fetcher.

---

## Module 3 — Resolver

Một hàm duy nhất `resolveImport(spec, parentVfsPath, vfs, versionMap)`.

### Flow

```
spec là relative ("./" hay "../")
  → vfs.resolve(parent, spec)
  → done

spec là bare ("vite", "@scope/pkg", "vite/client")
  → tách thành pkgName + subpath
      "vite"          → pkg="vite",       subpath="."
      "vite/client"   → pkg="vite",       subpath="./client"
      "@scope/pkg/x"  → pkg="@scope/pkg", subpath="./x"

  → walk up từ parentDir tìm node_modules/<pkgName>/package.json
      (theo đúng Node resolution order — gần nhất trước)

  → đọc package.json (từ VFS, hoặc lazy fetch nếu chưa có)

  → resolveEntry(pkg, subpath):
      nếu pkg CÓ "exports" field:
        → resolvePackageExports(pkg, subpath, conditions)
        → match     → dùng kết quả (KHÔNG fallback xuống main/module)
        → null block → throw ERR_PACKAGE_PATH_NOT_EXPORTED
        → no match  → throw ERR_PACKAGE_PATH_NOT_EXPORTED
      nếu pkg KHÔNG có "exports":
        → subpath === "." → thử module → main → index.js
        → subpath khác   → dùng trực tiếp làm filepath

  → trả về absolute VFS path của file đích
```

> Resolver chỉ quan tâm đến VFS path. Việc file đó đã có trong VFS hay chưa là việc của Fetcher.

---

## Module 4 — Lazy Fetcher

### `package.json` cũng cần lazy fetch

Resolver cần đọc `package.json` của mỗi package để `resolveEntry`. Nếu package chưa từng được fetch thì `package.json` cũng chưa có trong VFS. Fetcher phải handle case này riêng — chỉ fetch `package.json` (nhẹ) thay vì cả file JS.

```ts
async function ensurePackageJson(pkgRoot, pkgName, version, vfsRead, vfsWrite) {
  const p = `${pkgRoot}/package.json`;
  if (vfsRead(p)) return; // đã có
  // fetch từ proxy: GET /pkgName@version/package.json
  // write vào VFS
}
```

### Double-write khi exports remap

Khi fetch file mà exports remap sang path khác, write cả hai VFS key:

- `vfsPath` gốc — để importer's lookup hit
- `resolvedVfsPath` — để direct lookup cũng hit

### Integrity check

Lockfile có `integrity` (sha512). Verify sau khi fetch, trước khi write VFS. Nếu fail → throw, không write rác vào cache.

```ts
async function verifyIntegrity(bytes: Uint8Array, integrity: string) {
  // integrity = "sha512-<base64>"
  const hash = await crypto.subtle.digest("SHA-512", bytes);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  if (`sha512-${b64}` !== integrity) throw new Error("integrity mismatch");
}
```

---

## Module 5 — npm install (Client side)

```ts
async function npmInstall(vfs) {
  const pkgJson = vfs.read("/package.json")

  // 1. gọi proxy
  const res = await fetch("/resolve", {
    method: "POST",
    body: pkgJson,
    headers: { "Content-Type": "application/json" }
  })
  const lockfile = await res.json()

  // 2. ghi lockfile vào VFS
  vfs.write("/package-lock.json", JSON.stringify(lockfile))

  // 3. build versionMap
  const versionMap = buildVersionMap(lockfile)

  // 4. pre-fetch package.json cho top-level deps
  //    các dep còn lại lazy fetch khi resolver cần
  await Promise.all(
    Object.keys(lockfile.packages ?? lockfile.dependencies ?? {})
      .filter(k => k.startsWith("node_modules/") && !k.slice(13).includes("/node_modules/"))
      .map(k => ensurePackageJson(...))
  )

  return versionMap
}
```

Pre-fetch `package.json` của top-level deps sau khi install giúp lần bundle đầu tiên không bị waterfall (resolver cần package.json → fetch → resolver tiếp tục → fetch tiếp...).

---

## Thứ tự implement

| Bước | Module                           | Ghi chú                      |
| ---- | -------------------------------- | ---------------------------- |
| 1    | `buildVersionMap`                | Nền tảng, không phụ thuộc gì |
| 2    | Proxy `/resolve`                 | Độc lập với client           |
| 3    | `ensurePackageJson`              | Cần versionMap               |
| 4    | `resolveEntry` + `resolveImport` | Cần package.json trong VFS   |
| 5    | `npmInstall` client              | Kết nối tất cả lại           |
| 6    | Integrity check                  | Thêm vào fetcher cuối cùng   |

---

## Những thứ cố tình KHÔNG làm

- Không verify `peerDependencies` — quá phức tạp, để npm trên proxy lo
- Không support `exports` conditions ngoài `import` / `require` / `default` — đủ cho 99% packages
- Không cache lockfile phía client (sessionStorage, etc.) — VFS đã là cache
