# @nstudio/nativescript-effect-ui

NativeScript rendering hosts for iOS, Android, macOS, Windows, and Linux, platform Effect Layers, and pure-TypeScript native primitives for [`@effect/ui`](https://github.com/Effect-TS/ui).

Mount standard `@effect/ui/html` (`Html.component`) trees directly onto native iOS, Android, macOS (AppKit), Windows (WinUI 3 / WinRT), and Linux (GTK4) views with zero WebViews, or compose native views directly via `NativeHost`.

## Installation

```bash
npm install @nstudio/nativescript-effect-ui effect
```

`@effect/ui` is currently in public preview on `pkg.pr.new`:

```bash
npm install https://pkg.pr.new/Effect-TS/ui/@effect/ui@5cb34b2
```

Install the optional platform peer dependencies for the targets you use:

- **iOS, Android, Windows, and Linux (`MasonHost` / `NativeHost`)**: `@nativescript/core` and `@triniwiz/nativescript-masonkit` (plus `@nativescript/windows` or `@nativescript/linux` for desktop V8 runtimes)
- **macOS Desktop (`MacosHost`)**: `@nativescript/macos-node-api`
- **Windows Desktop (`WindowsHost`)**: `@nativescript/windows` or `@nativescript/windows-napi`
- **Linux Desktop (`LinuxHost`)**: `@nativescript/linux` or `@nativescript/linux-napi`

## Quick Start

### iOS, Android, Windows, and Linux (`MasonHost`)

Mounts unmodified `@effect/ui/html` components onto native views backed by MasonKit's Rust/Taffy CSS Flexbox and Grid layout engine.

```ts
import { MasonHost } from '@nstudio/nativescript-effect-ui/mason';
import { NativePlatformLayer } from '@nstudio/nativescript-effect-ui/platform/native';
import { App } from './App';

MasonHost.run(App, {}, {
  title: 'Effect Pulse',
  layer: NativePlatformLayer,
});
```

### macOS, Windows, and Linux Desktop (`MacosHost` / `WindowsHost` / `LinuxHost`)

Mount the exact same `@effect/ui/html` components onto native AppKit, WinUI/WinRT, or GTK4 windows with zero WebViews or Electron:

```ts
// macOS (AppKit)
import { MacosHost, MacosPlatformLayer } from '@nstudio/nativescript-effect-ui/macos';
await MacosHost.run(App, {}, { title: 'Effect Pulse', width: 460, height: 820, layer: MacosPlatformLayer });

// Windows (WinUI 3 / XAML Islands / WinRT Composition)
import { WindowsHost, WindowsPlatformLayer } from '@nstudio/nativescript-effect-ui/windows';
await WindowsHost.run(App, {}, { title: 'Effect Pulse', width: 460, height: 820, layer: WindowsPlatformLayer });

// Linux (GTK4)
import { LinuxHost, LinuxPlatformLayer } from '@nstudio/nativescript-effect-ui/linux';
await LinuxHost.run(App, {}, { title: 'Effect Pulse', width: 460, height: 820, layer: LinuxPlatformLayer });
```

## Subpath Exports

| Subpath | Description |
| --- | --- |
| `@nstudio/nativescript-effect-ui` | Platform service contracts (`Haptics`, `DeviceInfo`, `AppLifecycle`, `Clipboard`) |
| `@nstudio/nativescript-effect-ui/mason` | `MasonHost` for standard `@effect/ui/html` on iOS, Android, Windows, and Linux |
| `@nstudio/nativescript-effect-ui/macos` | `MacosHost` and `MacosPlatformLayer` for native macOS AppKit |
| `@nstudio/nativescript-effect-ui/windows` | `WindowsHost` and `WindowsPlatformLayer` for native Windows (WinUI 3 / WinRT) |
| `@nstudio/nativescript-effect-ui/linux` | `LinuxHost` and `LinuxPlatformLayer` for native Linux (GTK4) |
| `@nstudio/nativescript-effect-ui/native` | `NativeHost`, `Native`, and `NativeCommand` for direct NativeScript view vocabularies |
| `@nstudio/nativescript-effect-ui/platform` | Shared platform service interfaces and Web/fallback layers |
| `@nstudio/nativescript-effect-ui/platform/native` | NativeScript `NativePlatformLayer` implementations for iOS, Android, Windows, and Linux |
| `@nstudio/nativescript-effect-ui/motion` | UI-thread spring and timing motion (`UIViewPropertyAnimator` / Android `Animator`) |
| `@nstudio/nativescript-effect-ui/sheet` | Native bottom sheets (`UISheetPresentationController` / Android `BottomSheetDialog`) |
| `@nstudio/nativescript-effect-ui/list` | Virtualized recycled lists (`UITableView` / `RecyclerView`) |
| `@nstudio/nativescript-effect-ui/keyboard` | Keyboard-docked input accessories (`inputAccessoryView` / Android IME insets) |
| `@nstudio/nativescript-effect-ui/crash` | Unhandled fault boundary and recovery view |
| `@nstudio/nativescript-effect-ui/devtools` | Runtime inspector and `@effect/ui` devtools bridge |
| `@nstudio/nativescript-effect-ui/testing` | Host testing utilities and mock platform layers |

## Examples and Documentation

Full monorepo with shared Web, iOS, Android, macOS, Windows, and Linux apps: [github.com/nstudio/ns-effect-ui](https://github.com/nstudio/ns-effect-ui)

## License

MIT License. Copyright OpenJS Foundation and other contributors. See [LICENSE](./LICENSE).
