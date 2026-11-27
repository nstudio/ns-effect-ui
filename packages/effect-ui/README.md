# @nstudio/nativescript-effect-ui

NativeScript and macOS AppKit rendering hosts, platform Effect Layers, and pure-TypeScript native primitives for [`@effect/ui`](https://github.com/Effect-TS/ui).

Mount standard `@effect/ui/html` (`Html.component`) trees directly onto native iOS, Android, and macOS views with zero WebViews, or compose native UIKit/AppKit/Android views directly via `NativeHost`.

## Installation

```bash
npm install @nstudio/nativescript-effect-ui effect
```

`@effect/ui` is currently in public preview on `pkg.pr.new`:

```bash
npm install https://pkg.pr.new/Effect-TS/ui/@effect/ui@5cb34b2
```

Install the optional platform peer dependencies for the targets you use:

- **iOS and Android (`MasonHost` / `NativeHost`)**: `@nativescript/core` and `@triniwiz/nativescript-masonkit`
- **macOS Desktop (`MacosHost`)**: `@nativescript/macos-node-api`

## Quick Start

### iOS and Android (`MasonHost`)

Mounts unmodified `@effect/ui/html` components onto native iOS and Android views backed by MasonKit's Rust/Taffy CSS Flexbox and Grid layout engine.

```ts
import { MasonHost } from '@nstudio/nativescript-effect-ui/mason';
import { NativePlatformLayer } from '@nstudio/nativescript-effect-ui/platform/native';
import { App } from './App';

MasonHost.run(App, {}, {
  title: 'Effect Pulse',
  layer: NativePlatformLayer,
});
```

### macOS Desktop (`MacosHost`)

Mounts the same `@effect/ui/html` components onto real AppKit views (`NSWindow`, `NSView`, `NSTextField`, `NSButton`, `NSScrollView`) with zero WebViews or Electron.

```ts
import { MacosHost, MacosPlatformLayer } from '@nstudio/nativescript-effect-ui/macos';
import { App } from './App';

await MacosHost.run(App, {}, {
  title: 'Effect Pulse',
  width: 460,
  height: 820,
  layer: MacosPlatformLayer,
});
```

## Subpath Exports

| Subpath | Description |
| --- | --- |
| `@nstudio/nativescript-effect-ui` | Platform service contracts (`Haptics`, `Share`, `Storage`, `DeviceInfo`, `PlatformAppearance`) |
| `@nstudio/nativescript-effect-ui/mason` | `MasonHost` for standard `@effect/ui/html` on native iOS and Android |
| `@nstudio/nativescript-effect-ui/macos` | `MacosHost` and `MacosPlatformLayer` for native macOS AppKit |
| `@nstudio/nativescript-effect-ui/native` | `NativeHost`, `Native`, and `NativeCommand` for direct NativeScript view vocabularies |
| `@nstudio/nativescript-effect-ui/platform` | Shared platform service interfaces and Web/fallback layers |
| `@nstudio/nativescript-effect-ui/platform/native` | NativeScript `NativePlatformLayer` implementations for iOS and Android |
| `@nstudio/nativescript-effect-ui/motion` | UI-thread spring and timing motion (`UIViewPropertyAnimator` / Android `Animator`) |
| `@nstudio/nativescript-effect-ui/sheet` | Native bottom sheets (`UISheetPresentationController` / Android `BottomSheetDialog`) |
| `@nstudio/nativescript-effect-ui/list` | Virtualized recycled lists (`UITableView` / `RecyclerView`) |
| `@nstudio/nativescript-effect-ui/keyboard` | Keyboard-docked input accessories (`inputAccessoryView` / Android IME insets) |
| `@nstudio/nativescript-effect-ui/crash` | Unhandled fault boundary and recovery view |
| `@nstudio/nativescript-effect-ui/devtools` | Runtime inspector and `@effect/ui` devtools bridge |
| `@nstudio/nativescript-effect-ui/testing` | Host testing utilities and mock platform layers |

## Examples and Documentation

Full monorepo with shared Web, iOS, Android, and macOS apps: [github.com/nstudio/ns-effect-ui](https://github.com/nstudio/ns-effect-ui)

## License

MIT License. Copyright OpenJS Foundation and other contributors. See [LICENSE](./LICENSE).
