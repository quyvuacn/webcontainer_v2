/**
 * npm proxy server — replacement for unpkg.com
 *
 * API:
 *   GET  /<pkg>@<version>/<filepath>        serve file
 *   HEAD /<pkg>@<version>/<filepath>        check existence
 *   GET  /@scope/pkg@<version>/<filepath>   scoped packages
 *
 * On first request for any file in a package@version:
 *   1. Downloads the tarball from npm registry
 *   2. Extracts ALL files to .pkg-cache/<pkg>/<version>/
 *   3. Serves the requested file from disk
 *
 * Subsequent requests are instant disk reads.
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import os from "node:os";
import { execSync } from "node:child_process";
import { extract as tarExtract } from "tar-stream";

const PORT = Number(process.env.PORT ?? 4873);
const CACHE_DIR =
  process.env.CACHE_DIR ?? path.join(process.cwd(), ".pkg-cache");
const LOCK_CACHE_DIR =
  process.env.LOCK_CACHE_DIR ?? path.join(process.cwd(), ".lock-cache");
const NPM_REGISTRY = process.env.NPM_REGISTRY ?? "https://registry.npmjs.org";

fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(LOCK_CACHE_DIR, { recursive: true });

// ── URL parsing ───────────────────────────────────────────────────────────────

function parseUrl(url) {
  const p = url.replace(/^\//, "").toLowerCase();

  // Scoped: @scope/name@version/filepath
  const scoped = p.match(/^(@[^/]+\/[^@/]+)@([^/]+)\/(.+)$/);
  if (scoped)
    return { pkg: scoped[1], version: scoped[2], filepath: scoped[3] };

  // Plain: name@version/filepath
  const plain = p.match(/^([^@/][^@/]*)@([^/]+)\/(.+)$/);
  if (plain) return { pkg: plain[1], version: plain[2], filepath: plain[3] };

  return null;
}

// ── Cache paths ───────────────────────────────────────────────────────────────

function pkgCacheDir(pkg, version) {
  // @scope/name → _scope_name  (safe directory name)
  const safe = pkg.replace(/^@/, "_").replace("/", "__");
  return path.join(CACHE_DIR, safe, version);
}

function cachedFilePath(pkg, version, filepath) {
  return path.join(pkgCacheDir(pkg, version), filepath);
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "npm-proxy/1.0" } }, (res) => {
        if (
          res.statusCode === 301 ||
          res.statusCode === 302 ||
          res.statusCode === 307
        ) {
          return resolve(httpsGet(res.headers.location));
        }
        resolve(res);
      })
      .on("error", reject);
  });
}

// ── Tarball extraction ────────────────────────────────────────────────────────

const extracting = new Map();

async function downloadAndExtract(pkg, version) {
  const cacheDir = pkgCacheDir(pkg, version);
  const doneFile = path.join(cacheDir, ".extracted");

  if (fs.existsSync(doneFile)) return;

  const key = `${pkg}@${version}`;
  if (extracting.has(key)) return extracting.get(key);

  const work = (async () => {
    fs.mkdirSync(cacheDir, { recursive: true });

    // Tarball URL: scoped packages use last segment for filename
    const pkgBasename = pkg.includes("/") ? pkg.split("/").pop() : pkg;
    const tarballUrl = `${NPM_REGISTRY}/${pkg}/-/${pkgBasename}-${version}.tgz`;

    console.log(`[proxy] downloading ${key}`);
    const res = await httpsGet(tarballUrl);
    if (res.statusCode !== 200)
      throw new Error(`Registry returned ${res.statusCode} for ${tarballUrl}`);

    await new Promise((resolve, reject) => {
      const gunzip = zlib.createGunzip();
      const extract = tarExtract();

      extract.on("entry", (header, stream, next) => {
        // npm tarballs contain files under "package/" prefix
        const rel = header.name.replace(/^package\//, "");
        if (!rel || header.type !== "file") {
          stream.resume();
          next();
          return;
        }

        const dest = path.join(cacheDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });

        const chunks = [];
        stream.on("data", (c) => chunks.push(c));
        stream.on("end", () => {
          fs.writeFileSync(dest, Buffer.concat(chunks));
          next();
        });
        stream.on("error", next);
      });

      extract.on("finish", resolve);
      extract.on("error", reject);
      gunzip.on("error", reject);

      res.pipe(gunzip).pipe(extract);
    });

    // Mark extraction done
    fs.writeFileSync(doneFile, "");
    console.log(`[proxy] extracted ${key} → ${cacheDir}`);
  })();

  work.catch(() => {}).finally(() => extracting.delete(key));
  extracting.set(key, work);
  return work;
}

// ── Request handler ───────────────────────────────────────────────────────────

function setCorsHeaders(res) {
  // Required for COEP: require-corp pages
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
}

async function handle(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url ?? "";

  // ── Module 1: POST /resolve — nhận package.json, trả package-lock.json ────
  //
  //  1. hash(body) → check disk cache
  //  2. cache hit  → trả ngay
  //  3. cache miss → mkdir tmp/<hash>/ → write package.json
  //                → npm install --package-lock-only --ignore-scripts
  //                → read package-lock.json → write cache → rm tmp → trả về
  //
  if (req.method === "POST" && url === "/resolve") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    const hash = crypto
      .createHash("sha256")
      .update(body)
      .digest("hex")
      .slice(0, 16);
    const lockCachePath = path.join(LOCK_CACHE_DIR, hash, "package-lock.json");

    if (fs.existsSync(lockCachePath)) {
      const cached = fs.readFileSync(lockCachePath);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.writeHead(200);
      res.end(cached);
      return;
    }

    const tmpDir = path.join(os.tmpdir(), `npm-resolve-${hash}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "package.json"), body);

    try {
      console.log(`[proxy] resolving lockfile hash=${hash}`);
      execSync(
        "npm install --package-lock-only --ignore-scripts --prefer-offline",
        { cwd: tmpDir, timeout: 60_000, stdio: "pipe" },
      );

      const lockContent = fs.readFileSync(
        path.join(tmpDir, "package-lock.json"),
      );
      fs.mkdirSync(path.dirname(lockCachePath), { recursive: true });
      fs.writeFileSync(lockCachePath, lockContent);

      res.setHeader("Content-Type", "application/json");
      res.writeHead(200);
      res.end(lockContent);
    } catch (e) {
      res.writeHead(500);
      res.end(`npm resolve failed: ${e.message}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    return;
  }

  // ── Registry proxy: GET /registry/<pkg>  →  forward to npm registry ──────
  // Allows browser to fetch packuments without hitting registry directly
  // (avoids COEP issues with registry.npmjs.org not sending CORP headers)
  if (url.startsWith("/registry/")) {
    const pkgName = url.slice("/registry/".length);
    try {
      const upstream = await httpsGet(`${NPM_REGISTRY}/${pkgName}`);
      const chunks = [];
      for await (const chunk of upstream) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.writeHead(upstream.statusCode ?? 200);
      res.end(body);
    } catch (e) {
      res.writeHead(502);
      res.end(e.message);
    }
    return;
  }

  const parsed = parseUrl(url);
  if (!parsed) {
    res.writeHead(400);
    res.end("Bad Request: expected /<pkg>@<version>/<filepath>");
    return;
  }

  const { pkg, version, filepath } = parsed;

  try {
    await downloadAndExtract(pkg, version);
  } catch (e) {
    console.error(`[proxy] extract error for ${pkg}@${version}:`, e.message);
    res.writeHead(502);
    res.end(`Failed to fetch package: ${e.message}`);
    return;
  }

  const filePath = cachedFilePath(pkg, version, filepath);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  if (req.method === "HEAD") {
    const stat = fs.statSync(filePath);
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Type", guessContentType(filepath));
    res.writeHead(200);
    res.end();
    return;
  }

  const bytes = fs.readFileSync(filePath);
  res.setHeader("Content-Type", guessContentType(filepath));
  res.setHeader("Content-Length", bytes.length);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.writeHead(200);
  res.end(bytes);
}

function guessContentType(filepath) {
  if (filepath.endsWith(".json")) return "application/json";
  if (
    filepath.endsWith(".mjs") ||
    filepath.endsWith(".js") ||
    filepath.endsWith(".cjs")
  )
    return "application/javascript";
  if (filepath.endsWith(".ts") || filepath.endsWith(".tsx"))
    return "application/typescript";
  if (filepath.endsWith(".css")) return "text/css";
  if (filepath.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

// ── Start ─────────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error("[proxy] unhandled error:", e);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  });
});

server.listen(PORT, () => {
  console.log(`npm proxy server running at http://localhost:${PORT}`);
  console.log(`cache dir: ${CACHE_DIR}`);
});
