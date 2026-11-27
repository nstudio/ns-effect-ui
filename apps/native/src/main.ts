import {
  Application,
  ContentView,
  Frame,
  Page,
  ScrollView,
  TabView,
  TabViewItem,
  TouchManager,
  Utils,
  type View as NSView,
} from '@nativescript/core';
import {
  makeHtmlCrashFallback,
  makeNativeCrashFallback,
} from '@nativescript/effect-ui/crash';
import { makeBridge, resolveDevToolsUrl } from '@nativescript/effect-ui/devtools';
import {
  DismissKeyboard,
  KeyboardNativeLayer,
} from '@nativescript/effect-ui/keyboard';
import { ensureRuntimeGlobals, MasonHost } from '@nativescript/effect-ui/mason';
import { NativeMotionLayer } from '@nativescript/effect-ui/motion';
import { NativeHost } from '@nativescript/effect-ui/native';
import { ClipboardNativeLayer, NativePlatformLayer } from '@nativescript/effect-ui/platform/native';
import { Clipboard } from '@nativescript/effect-ui/platform';
import { PulseApp, SharedDomainLayer } from '@ns-effect-ui/shared';
import { Scroll, View as MasonView } from '@triniwiz/nativescript-masonkit';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { bindNativeLabDevToolsReader, NativeControlLab } from './native-lab.ts';

ensureRuntimeGlobals();
MasonView.preflight = true;
TouchManager.enableGlobalTapAnimations = true;

const devToolsUrl = resolveDevToolsUrl(4774);
const devTools = makeBridge({
  serverUrl: devToolsUrl,
  bufferSize: 500,
});
bindNativeLabDevToolsReader(() => devTools.getStats().totalEncoded);

const copyToNativeClipboard = (text: string) => {
  Effect.runFork(
    Effect.gen(function* () {
      const cb = yield* Clipboard;
      yield* cb.copy(text);
    }).pipe(Effect.provide(ClipboardNativeLayer)),
  );
};

const KeyboardLayer = Layer.mergeAll(
  KeyboardNativeLayer,
  DismissKeyboard.layer.pipe(Layer.provide(KeyboardNativeLayer)),
);

const AppLayer = Layer.mergeAll(
  SharedDomainLayer.pipe(Layer.provideMerge(NativePlatformLayer)),
  NativeMotionLayer,
  KeyboardLayer,
  devTools.layer,
);

Application.run({
  create: () => {
    const frame = new Frame();
    frame.navigate({
      create: () => {
        const page = new Page();
        page.actionBarHidden = false;
        if (page.actionBar) {
          page.actionBar.title = 'Effect Pulse';
          page.actionBar.flat = true;
        }

        // Android 15/16+ edge-to-edge (per ns-android-edge-to-edge):
        // Let the page & scroll containers bleed seamlessly behind the gesture
        // navigation strip while keeping status bar clearance intact and padding
        // inner scroll content by the real WindowMetrics navigation bar inset.
        let androidBottomInsetDip = 0;
        if (typeof __ANDROID__ !== 'undefined' && __ANDROID__) {
          (page as unknown as { androidOverflowEdge?: string }).androidOverflowEdge = 'bottom';
          try {
            const activity = Utils.android.getCurrentActivity();
            if (activity && android.os.Build.VERSION.SDK_INT >= 30) {
              const navPx = activity
                .getWindowManager()
                .getCurrentWindowMetrics()
                .getWindowInsets()
                .getInsets(android.view.WindowInsets.Type.navigationBars()).bottom;
              androidBottomInsetDip = Math.round(Utils.layout.toDeviceIndependentPixels(navPx));
            }
          } catch {
            // Fallback to default padding when window metrics are unavailable.
          }
        }

        // Tab 1: Shared HTML-compatible Effect UI app rendered via MasonHost!
        const masonRoot = new Scroll() as unknown as NSView;
        const masonStyle = masonRoot.style as unknown as Record<string, unknown>;
        masonStyle['width'] = '100%';
        masonStyle['height'] = '100%';
        if (androidBottomInsetDip > 0) {
          masonStyle['paddingBottom'] = androidBottomInsetDip;
        }

        const sharedTab = new TabViewItem();
        sharedTab.title = 'Effect Pulse';
        sharedTab.view = masonRoot;

        // Tab 2: Native Lab showcasing UI-thread Motion, Native Sheet,
        // 1,000-row VirtualList, Keyboard Subscription, DevTools & Controls!
        const nativeScroll = new ScrollView();
        const nativeContainer = new ContentView();
        if (androidBottomInsetDip > 0) {
          nativeContainer.style.paddingBottom = androidBottomInsetDip;
        }
        nativeScroll.content = nativeContainer;

        const nativeTab = new TabViewItem();
        nativeTab.title = 'Native Lab';
        nativeTab.view = nativeScroll as unknown as NSView;

        const tabView = new TabView();
        if (typeof __ANDROID__ !== 'undefined' && __ANDROID__) {
          (tabView as unknown as { androidOverflowEdge?: string }).androidOverflowEdge = 'bottom';
        }
        tabView.items = [sharedTab, nativeTab];
        page.content = tabView as unknown as NSView;

        const mountShared = () => {
          const sharedMount = MasonHost.mount(PulseApp, {}, masonRoot, {
            host: {
              onTitle: (title) => {
                if (page.actionBar) page.actionBar.title = title;
              },
            },
            fallback: makeHtmlCrashFallback({
              componentName: 'Effect Pulse',
              onCopy: copyToNativeClipboard,
              onRestart: () => mountShared(),
            }),
          }).pipe(Layer.provide(AppLayer));

          Effect.runFork(Layer.launch(sharedMount));
        };

        const mountNativeLab = () => {
          const nativeMount = NativeHost.mount(NativeControlLab, {}, nativeContainer, {
            fallback: makeNativeCrashFallback({
              componentName: 'Native Lab',
              onCopy: copyToNativeClipboard,
              onRestart: () => mountNativeLab(),
            }),
          }).pipe(Layer.provide(AppLayer));

          Effect.runFork(Layer.launch(nativeMount));
        };

        mountShared();
        mountNativeLab();

        return page;
      },
      animated: false,
    });
    return frame;
  },
});
