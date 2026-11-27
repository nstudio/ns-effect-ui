/**
 * Live DevTools bridge (`NativeDevTools`) for `@nstudio/nativescript-effect-ui`.
 *
 * Uses `@effect/ui`'s built-in `MessageLog.makeEncoded` to encode Wire frames
 * off the app's hot update path, retains a bounded ring buffer for in-app or
 * test inspection, and streams newline-free JSON Wire frames (`Hello` +
 * `WireEntry`) over WebSocket to an `@effect/ui-devtools` server (auto-resolving
 * `127.0.0.1` on iOS Simulator and `10.0.2.2` on Android Emulator).
 */
import * as MessageLog from '@effect/ui/MessageLog';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

export interface DevToolsWebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}

export type DevToolsWebSocketCtor = new (url: string) => DevToolsWebSocketLike;

export interface DevToolsStats {
  readonly connected: boolean;
  readonly bufferedFrames: number;
  readonly totalEncoded: number;
  readonly totalSent: number;
  readonly serverUrl: string | undefined;
}

export interface DevToolsBridgeHandle {
  /** Provides `MessageLog.MessageLog` to any mounted Effect UI root. */
  readonly layer: Layer.Layer<never>;
  /** Snapshot of all buffered Wire frames (in chronological order). */
  readonly getFrames: () => ReadonlyArray<MessageLog.WireEntry>;
  /** Current connection & throughput metrics. */
  readonly getStats: () => DevToolsStats;
  /** Subscribe to newly encoded Wire frames (e.g. for an in-app HUD or test). */
  readonly subscribe: (listener: (frames: ReadonlyArray<MessageLog.WireEntry>) => void) => () => void;
}

export interface DevToolsBridgeOptions {
  /** WebSocket endpoint of an `@effect/ui-devtools` server (e.g. `ws://127.0.0.1:4774`). */
  readonly serverUrl?: string | undefined;
  /** Maximum number of encoded Wire frames kept in the ring buffer. Defaults to `500`. */
  readonly bufferSize?: number | undefined;
  /** Max serialized bytes per Wire entry. */
  readonly maxEntryBytes?: number | undefined;
  /** Host tag reported in the Wire `Hello` frame. Defaults to `"browser"` (valid WireHost). */
  readonly host?: MessageLog.WireHost | undefined;
  /** Reconnect delay in ms after a WebSocket close. Defaults to `1500`. */
  readonly reconnectMs?: number | undefined;
  /** Optional WebSocket constructor override (used in tests or custom runtimes). */
  readonly WebSocketCtor?: DevToolsWebSocketCtor | undefined;
}

/**
 * Resolves the default local DevTools server URL for the current runtime:
 * - Android Emulator maps host loopback to `10.0.2.2`
 * - iOS Simulator / macOS / Web use `127.0.0.1`
 */
export function resolveDevToolsUrl(port = 4774, path = ''): string {
  const host =
    typeof __ANDROID__ !== 'undefined' && __ANDROID__ ? '10.0.2.2' : '127.0.0.1';
  const suffix = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  return `ws://${host}:${port}${suffix}`;
}

const WS_OPEN = 1;

/**
 * Creates a live `NativeDevTools` bridge handle (`layer` + live `getFrames` /
 * `getStats` / `subscribe`).
 *
 * Provide `bridge.layer` alongside `MasonHost.mount` or `NativeHost.mount` to
 * stream every `Update`, `Mounted`, `QueryChanged`, `CommandStarted`, and
 * `Failed` Wire frame with zero impact on production builds.
 */
export function makeBridge(options?: DevToolsBridgeOptions | undefined): DevToolsBridgeHandle {
  const bufferSize = Math.max(1, options?.bufferSize ?? 500);
  const serverUrl = options?.serverUrl;
  const reconnectMs = options?.reconnectMs ?? 1500;
  const host: MessageLog.WireHost = options?.host ?? 'browser';

  const buffer: Array<MessageLog.WireEntry> = [];
  const listeners = new Set<(frames: ReadonlyArray<MessageLog.WireEntry>) => void>();

  let ws: DevToolsWebSocketLike | null = null;
  let connected = false;
  let disposed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let totalEncoded = 0;
  let totalSent = 0;

  const helloFrame = JSON.stringify({
    _tag: 'Hello',
    version: MessageLog.wireVersion,
    host,
  });

  const sendRaw = (payload: string): boolean => {
    if (!ws || ws.readyState !== WS_OPEN) return false;
    try {
      ws.send(payload);
      totalSent += 1;
      return true;
    } catch {
      return false;
    }
  };

  const connect = (): void => {
    if (disposed || !serverUrl) return;
    const Ctor: DevToolsWebSocketCtor | undefined =
      options?.WebSocketCtor ??
      ((globalThis as unknown as { WebSocket?: DevToolsWebSocketCtor }).WebSocket);
    if (!Ctor) return;

    try {
      const socket = new Ctor(serverUrl);
      ws = socket;
      socket.onopen = () => {
        if (disposed || ws !== socket) return;
        connected = true;
        sendRaw(helloFrame);
        for (const frame of buffer) {
          sendRaw(JSON.stringify(frame));
        }
      };
      socket.onerror = () => {
        connected = false;
      };
      socket.onclose = () => {
        if (ws === socket) {
          ws = null;
          connected = false;
        }
        if (!disposed && serverUrl && reconnectMs > 0) {
          reconnectTimer = setTimeout(connect, reconnectMs);
        }
      };
    } catch {
      connected = false;
    }
  };

  const layer: Layer.Layer<never> = Layer.effect(
    MessageLog.MessageLog,
    Effect.gen(function* () {
      disposed = false;
      connect();

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          disposed = true;
          connected = false;
          if (reconnectTimer !== null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
          }
          try {
            ws?.close();
          } catch {
            // Ignore close errors.
          }
          ws = null;
        }),
      );

      return yield* MessageLog.makeEncoded(
        (batch) =>
          Effect.sync(() => {
            totalEncoded += batch.length;
            for (const frame of batch) {
              buffer.push(frame);
              if (buffer.length > bufferSize) {
                buffer.shift();
              }
              sendRaw(JSON.stringify(frame));
            }
            for (const listener of listeners) {
              listener(batch);
            }
          }),
        { maxEntryBytes: options?.maxEntryBytes },
      );
    }),
  ) as unknown as Layer.Layer<never>;

  return {
    layer,
    getFrames: () => buffer.slice(),
    getStats: () => ({
      connected,
      bufferedFrames: buffer.length,
      totalEncoded,
      totalSent,
      serverUrl,
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Convenience Layer for dropping live DevTools streaming straight into a
 * mounted NativeScript Effect UI tree.
 */
export const layer = (options?: DevToolsBridgeOptions | undefined): Layer.Layer<never> =>
  makeBridge(options).layer;

export const NativeDevTools = {
  makeBridge,
  layer,
  resolveDevToolsUrl,
} as const;
