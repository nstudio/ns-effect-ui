import {
  Application,
  ContentView,
  Frame,
  Page,
  ScrollView,
  TabView,
  TabViewItem,
  TouchManager,
  type View as NSView,
} from '@nativescript/core';
import { ensureRuntimeGlobals, MasonHost } from '@nativescript/effect-ui/mason';
import { NativeHost } from '@nativescript/effect-ui/native';
import { NativePlatformLayer } from '@nativescript/effect-ui/platform/native';
import { PulseApp, SharedDomainLayer } from '@ns-effect-ui/shared';
import { Scroll, View as MasonView } from '@triniwiz/nativescript-masonkit';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { NativeControlLab } from './native-lab.ts';

ensureRuntimeGlobals();
MasonView.preflight = true;
TouchManager.enableGlobalTapAnimations = true;

const AppLayer = SharedDomainLayer.pipe(Layer.provideMerge(NativePlatformLayer));

Application.run({
  create: () => {
    const frame = new Frame();
    frame.navigate({
      create: () => {
        const page = new Page();
        page.actionBarHidden = false;
        if (page.actionBar) {
          page.actionBar.title = 'Effect Pulse';
        }

        // Tab 1: Shared HTML-compatible Effect UI app rendered via MasonHost!
        const masonRoot = new Scroll() as unknown as NSView;
        const masonStyle = masonRoot.style as unknown as Record<string, unknown>;
        masonStyle['width'] = '100%';
        masonStyle['height'] = '100%';

        const sharedTab = new TabViewItem();
        sharedTab.title = 'Effect Pulse';
        sharedTab.view = masonRoot;

        // Tab 2: Dedicated NativeScript core vocabulary rendered via NativeHost!
        const nativeScroll = new ScrollView();
        const nativeContainer = new ContentView();
        nativeScroll.content = nativeContainer;

        const nativeTab = new TabViewItem();
        nativeTab.title = 'Native Lab';
        nativeTab.view = nativeScroll as unknown as NSView;

        const tabView = new TabView();
        tabView.items = [sharedTab, nativeTab];
        page.content = tabView as unknown as NSView;

        // Mount both Effect UI trees onto their respective NativeScript hosts.
        const sharedMount = MasonHost.mount(PulseApp, {}, masonRoot, {
          host: {
            onTitle: (title) => {
              if (page.actionBar) page.actionBar.title = title;
            },
          },
        }).pipe(Layer.provide(AppLayer));

        const nativeMount = NativeHost.mount(NativeControlLab, {}, nativeContainer).pipe(
          Layer.provide(AppLayer),
        );

        Effect.runFork(Layer.launch(Layer.mergeAll(sharedMount, nativeMount)));

        return page;
      },
      animated: false,
    });
    return frame;
  },
});
