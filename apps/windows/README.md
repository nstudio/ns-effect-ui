# Effect Pulse for Windows

Runs the shared `PulseApp` (`@ns-effect-ui/shared`) natively on Windows with zero WebViews and zero Electron.

## Option 1: Standalone Node-API Host (`@nativescript/windows-napi`)

Runs directly under Node.js 18+ or Bun on Windows x64/arm64 using `WindowsHost` (XAML Islands / WinRT Composition):

```powershell
pnpm install
pnpm windows
# or with Node:
pnpm --filter @ns-effect-ui/windows start:node
```

## Option 2: Full NativeScript WinUI 3 App (`@nativescript/windows` + MasonKit)

`@triniwiz/nativescript-masonkit` ships native Windows (`index.windows.js`) support alongside `@nativescript/windows`:

```powershell
cd apps/native
ns platform add windows
ns run windows --no-hmr
```
