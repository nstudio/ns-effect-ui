/**
 * Dedicated NativeScript element vocabulary for `@effect/ui` (Strategy A,
 * modeled on `@effect/ui-opentui`).
 *
 * Developers can build strongly-typed NativeScript views directly with native
 * controls (`stackLayout`, `flexboxLayout`, `gridLayout`, `scrollView`,
 * `label`, `button`, `textField`, `textView`, `switch`, `slider`, `progress`,
 * `activityIndicator`, `image`, `searchBar`).
 */
import * as Component from '@effect/ui/Component';
import * as Renderer from '@effect/ui/Renderer';
import * as View from '@effect/ui/View';
import type {
  AbsoluteLayout,
  ActivityIndicator,
  Button,
  ContentView,
  DockLayout,
  FlexboxLayout,
  GridLayout,
  Image,
  Label,
  Progress,
  ScrollView,
  SearchBar,
  Slider,
  StackLayout,
  Switch,
  TextField,
  TextView,
  View as NSView,
  WrapLayout,
} from '@nativescript/core';
import * as Context from 'effect/Context';

export interface NativeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface NativeAnimateOptions {
  readonly opacity?: number | undefined;
  readonly scale?: { readonly x: number; readonly y: number } | undefined;
  readonly translate?: { readonly x: number; readonly y: number } | undefined;
  readonly rotate?: number | undefined;
  readonly duration?: number | undefined;
}

/**
 * The NativeScript core host marker and imperative view operations used by
 * `NativeCommand`. Provided by `NativeHost.layer`.
 */
export class Host extends Context.Service<
  Host,
  {
    readonly focus: (node: NSView) => void;
    readonly blur: (node: NSView) => void;
    readonly measure: (node: NSView) => NativeRect;
    readonly animate: (node: NSView, options: NativeAnimateOptions) => Promise<void>;
  }
>()('@nativescript/effect-ui/Native/Host') {}

declare module '@effect/ui/Command' {
  interface FrameworkServices {
    readonly NativeHost: Host;
  }
}

export interface TapPayload {}
export interface TextChangePayload {
  readonly value: string;
}
export interface CheckedChangePayload {
  readonly checked: boolean;
}
export interface ValueChangePayload {
  readonly value: number;
}
export interface ReturnPressPayload {
  readonly value: string;
}

export interface BaseEvents {
  readonly tap: TapPayload;
  readonly loaded: {};
  readonly unloaded: {};
}

export type EventsOf<K extends string> = K extends 'textField' | 'textView' | 'searchBar'
  ? BaseEvents & {
      readonly textChange: TextChangePayload;
      readonly returnPress: ReturnPressPayload;
      readonly submit: ReturnPressPayload;
      readonly focus: {};
      readonly blur: {};
    }
  : K extends 'switch'
    ? BaseEvents & {
        readonly checkedChange: CheckedChangePayload;
      }
    : K extends 'slider'
      ? BaseEvents & {
          readonly valueChange: ValueChangePayload;
        }
      : BaseEvents;

export interface TagNodeMap {
  readonly stackLayout: StackLayout;
  readonly flexboxLayout: FlexboxLayout;
  readonly gridLayout: GridLayout;
  readonly wrapLayout: WrapLayout;
  readonly absoluteLayout: AbsoluteLayout;
  readonly dockLayout: DockLayout;
  readonly scrollView: ScrollView;
  readonly contentView: ContentView;
  readonly label: Label;
  readonly button: Button;
  readonly textField: TextField;
  readonly textView: TextView;
  readonly switch: Switch;
  readonly slider: Slider;
  readonly progress: Progress;
  readonly activityIndicator: ActivityIndicator;
  readonly image: Image;
  readonly searchBar: SearchBar;
}

export type NoTextContent<Msg, R = never> =
  | View.Element<Msg, R>
  | View.Child<Msg, R>
  | View.Outlet
  | View.ElementBuilder<Msg, R, any, any>;

export type NoTextChildren<Msg, R = any> = ReadonlyArray<
  NoTextContent<Msg, R> | false | null | undefined
>;

export type NoTextInput<Msg, R = never> =
  | NoTextContent<Msg, R>
  | false
  | null
  | undefined
  | NoTextChildren<Msg, R>;

/**
 * Base builder for NativeScript core views (leaf controls like `label`, `button`,
 * `switch`, `slider`, `textField`, `progress`).
 */
export class NativeElement<
  out Msg,
  out R = never,
  in out E = Record<string, unknown>,
  in out Node = unknown,
  out Tag extends string = string,
> extends View.ElementBuilder<Msg, R, E, Node, Tag> {
  declare readonly '~With'?: NativeElement<Msg, R | this['~Add'], E, Node, Tag>;

  class(value: string): this {
    return this.attr('class', value);
  }

  id(value: string): this {
    return this.attr('id', value);
  }

  style(styles: Readonly<Record<string, unknown>>): this {
    const prev = (this.props['style'] as Record<string, unknown> | undefined) ?? {};
    return this.prop('style', { ...prev, ...styles });
  }

  text(value: string): this {
    return this.prop('text', value);
  }

  hint(value: string): this {
    return this.prop('hint', value);
  }

  textWrap(value: boolean): this {
    return this.prop('textWrap', value);
  }

  checked(value: boolean): this {
    return this.prop('checked', value);
  }

  value(value: number): this {
    return this.prop('value', value);
  }

  minValue(value: number): this {
    return this.prop('minValue', value);
  }

  maxValue(value: number): this {
    return this.prop('maxValue', value);
  }

  busy(value: boolean): this {
    return this.prop('busy', value);
  }

  src(value: string): this {
    return this.prop('src', value);
  }

  enabled(value: boolean): this {
    return this.prop('isEnabled', value);
  }

  visibility(value: 'visible' | 'hidden' | 'collapse'): this {
    return this.prop('visibility', value);
  }

  row(value: number): this {
    return this.prop('row', value);
  }

  col(value: number): this {
    return this.prop('col', value);
  }

  rowSpan(value: number): this {
    return this.prop('rowSpan', value);
  }

  colSpan(value: number): this {
    return this.prop('colSpan', value);
  }

  dock(value: 'left' | 'top' | 'right' | 'bottom'): this {
    return this.prop('dock', value);
  }
}

/**
 * Builder for NativeScript layout containers (`stackLayout`, `flexboxLayout`,
 * `gridLayout`, `scrollView`, `contentView`, etc.).
 */
export class NativeContainerElement<
  out Msg,
  out R = never,
  in out E = Record<string, unknown>,
  in out Node = unknown,
  out Tag extends string = string,
> extends NativeElement<Msg, R, E, Node, Tag> {
  declare readonly '~With'?: NativeContainerElement<Msg, R | this['~Add'], E, Node, Tag>;

  orientation(value: 'vertical' | 'horizontal'): this {
    return this.prop('orientation', value);
  }

  rows(spec: string): this {
    return this.prop('rows', spec);
  }

  columns(spec: string): this {
    return this.prop('columns', spec);
  }

  children<This, const C extends ReadonlyArray<NoTextInput<Msg, unknown>>>(
    this: This,
    ...inputs: C
  ): View.WithRequirements<This, View.Requirements<C[number]>>;
  children(...inputs: ReadonlyArray<View.Input<Msg, unknown>>): unknown {
    return View.withNoTextContent(this, inputs, vocabulary);
  }
}

export const containerTags = [
  'stackLayout',
  'flexboxLayout',
  'gridLayout',
  'wrapLayout',
  'absoluteLayout',
  'dockLayout',
  'scrollView',
  'contentView',
] as const;

export const leafTags = [
  'label',
  'button',
  'textField',
  'textView',
  'switch',
  'slider',
  'progress',
  'activityIndicator',
  'image',
  'searchBar',
] as const;

export type ContainerTag = (typeof containerTags)[number];
export type LeafTag = (typeof leafTags)[number];
export type TagName = ContainerTag | LeafTag;

export type Tags<Msg> = {
  readonly [K in ContainerTag]: View.Shorthand<
    NativeContainerElement<Msg, never, EventsOf<K>, TagNodeMap[K], K>
  >;
} & {
  readonly [K in LeafTag]: NativeElement<Msg, never, EventsOf<K>, TagNodeMap[K], K>;
};

export interface Elements extends View.Elements {
  readonly Tags: Tags<this['Msg']>;
  readonly Host: Host;
}

export type H<Msg> = View.WithTags<Msg, unknown, Elements>;

export const Elements: Elements | undefined = undefined;
export const name = 'nativescript';

const makeTags = (): Readonly<Record<string, NativeElement<any, any, any, any, any>>> => {
  const out: Record<string, NativeElement<any, any, any, any, any>> = {};
  for (const tag of containerTags) {
    out[tag] = View.shorthand(new NativeContainerElement(tag));
  }
  for (const tag of leafTags) {
    out[tag] = new NativeElement(tag);
  }
  return out;
};

export const tags: Readonly<Record<string, NativeElement<any, any, any, any, any>>> = makeTags();

export const vocabulary: View.Vocabulary<Elements> = {
  name,
  tags,
  textParents: [],
};

export const component: Component.Define<Elements> = Component.withElements(vocabulary);

export const ref = <K extends TagName>(name: string, _tag: K): Renderer.Ref<TagNodeMap[K]> =>
  Renderer.ref<TagNodeMap[K]>(name);
