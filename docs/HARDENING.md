# Phase 7: Hardening

## Đã triển khai

- **VFS_PREFIX random**: Mỗi build sinh prefix mới (vd: `_a3f9b2c1_`)
- **Obfuscate JS**: `npm run build:obfuscate` dùng javascript-obfuscator

## Scripts

```bash
# Build production với random prefix
npm run build:prod

# Build + obfuscate (cần: npm i -D javascript-obfuscator)
npm run build:obfuscate
```

## Checklist trình duyệt

- [ ] Chrome/Edge
- [ ] Firefox (crossOriginIsolated, SharedArrayBuffer)
- [ ] Safari

## Performance

- Đo thời gian bootstrap
- Đo latency VFS read/write
- Đo npm install với ~50 packages
