# Effect Pulse for Linux

Runs the shared `PulseApp` (`@ns-effect-ui/shared`) natively on Linux GTK4 with zero WebViews and zero Electron.

## Option 1: Standalone Node-API Host (`@nativescript/linux-napi`)

Runs directly under Node.js 18+ or Bun on Linux x64/arm64 (requires GTK 4 system libraries) using `LinuxHost`:

```bash
pnpm install
pnpm linux
# or with Node:
pnpm --filter @ns-effect-ui/linux start:node
```

## Option 2: Full NativeScript Linux GTK4 App (`@nativescript/linux` + MasonKit)

`@triniwiz/nativescript-masonkit` ships native Linux (`index.linux.js` + `libmasonkit.so`) support alongside `@nativescript/linux`:

```bash
cd apps/native
ns platform add linux
ns run linux --no-hmr
```
