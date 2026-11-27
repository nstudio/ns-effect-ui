/**
 * HTML-shaped element factory backed by `@triniwiz/nativescript-masonkit`.
 *
 * Interactive/layout-bearing tags (`button`, `a`, `li`, `label`, `h1`–`h6`,
 * `dialog`, tables, etc.) are backed by `@CSSType(tag)` subclasses of MasonKit's
 * `Div` so they support CSS Flexbox, Grid, padding, border-radius, and mixed
 * element/text children (such as `@effect/ui-kit`'s `Switch` putting a `<span>`
 * thumb inside a `<button>`), while still matching tag CSS selectors.
 */
import { CSSType, type View as NSView } from '@nativescript/core';
import {
  Abbr,
  Address,
  Article,
  Aside,
  B,
  Bdi,
  Bdo,
  Blockquote,
  Br,
  Cite,
  Code,
  Dd,
  Del,
  Details,
  Dfn,
  Div,
  Dl,
  Dt,
  Em,
  Fieldset,
  Figcaption,
  Figure,
  Footer,
  Form,
  Header,
  Hgroup,
  Hr,
  I,
  Img,
  Input,
  Ins,
  Legend,
  Link,
  Main,
  Mark,
  Nav,
  Ol,
  Output,
  P,
  Picture,
  Pre,
  Q,
  S,
  Samp,
  Section,
  Small,
  Span,
  Strong,
  Sub,
  Summary,
  Sup,
  TextArea,
  Time,
  U,
  Ul,
  Var,
} from '@triniwiz/nativescript-masonkit';

/**
 * Lightweight DOM-compatible text node (`nodeType === 3`) that MasonKit's
 * `ViewBase.insertBefore` / `removeChild` adopts natively and binds via a
 * live `.data` setter proxy.
 */
export interface MasonTextNode {
  readonly _kind: 'text';
  readonly nodeType: 3;
  readonly nodeName: '#text';
  data: string;
  text: string;
}

/**
 * Off-tree fragment container used by `h.keepAlive` (`Host.createContainer`).
 * Never inserted into the native visual tree.
 */
export interface MasonContainer {
  readonly _kind: 'container';
  readonly children: Array<MasonNode>;
}

/**
 * Any node managed by `MasonHost`: a NativeScript/MasonKit `View`, a
 * `MasonTextNode`, or an off-tree `MasonContainer`.
 */
export type MasonNode = NSView | MasonTextNode | MasonContainer;

export type ElementConstructor = new () => NSView;

export const isTextNode = (node: MasonNode): node is MasonTextNode =>
  typeof node === 'object' && node !== null && (node as MasonTextNode)._kind === 'text';

export const isContainer = (node: MasonNode): node is MasonContainer =>
  typeof node === 'object' && node !== null && (node as MasonContainer)._kind === 'container';

export const isViewNode = (node: MasonNode): node is NSView =>
  !isTextNode(node) && !isContainer(node);

class MasonTextNodeImpl implements MasonTextNode {
  readonly _kind = 'text' as const;
  readonly nodeType = 3 as const;
  readonly nodeName = '#text' as const;
  #data: string;

  constructor(text: string) {
    this.#data = text;
  }

  /**
   * Prototype getter/setter so MasonKit's `_installTextNodeProxy` detects the
   * CharacterData-style `data` accessor and forwards live text edits directly
   * to the native `MasonTextNode` on iOS & Android.
   */
  get data(): string {
    return this.#data;
  }

  set data(value: string) {
    this.#data = value;
  }

  get text(): string {
    return this.#data;
  }

  set text(value: string) {
    this.#data = value;
  }
}

export function createTextNode(text: string): MasonTextNode {
  return new MasonTextNodeImpl(text);
}

export function createContainerNode(): MasonContainer {
  return {
    _kind: 'container',
    children: [],
  };
}

// Block-backed subclasses preserve each tag's CSS type selector while allowing
// full Flexbox/Grid layout and mixed element + text children.
function makeBlockElement(tag: string): ElementConstructor {
  class MasonBlockElement extends Div {}
  CSSType(tag)(MasonBlockElement);
  return MasonBlockElement as unknown as ElementConstructor;
}

const BLOCK_OVERRIDE_TAGS = [
  'button',
  'a',
  'li',
  'kbd',
  'label',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'dialog',
  'select',
  'option',
  'optgroup',
  'progress',
  'meter',
  'table',
  'caption',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'svg',
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'g',
] as const;

const buildDefaultRegistry = (): Record<string, ElementConstructor> => {
  const registry: Record<string, ElementConstructor> = {
    // Structural block elements
    div: Div as unknown as ElementConstructor,
    section: Section as unknown as ElementConstructor,
    header: Header as unknown as ElementConstructor,
    footer: Footer as unknown as ElementConstructor,
    article: Article as unknown as ElementConstructor,
    main: Main as unknown as ElementConstructor,
    nav: Nav as unknown as ElementConstructor,
    aside: Aside as unknown as ElementConstructor,
    ul: Ul as unknown as ElementConstructor,
    ol: Ol as unknown as ElementConstructor,
    figure: Figure as unknown as ElementConstructor,
    figcaption: Figcaption as unknown as ElementConstructor,
    address: Address as unknown as ElementConstructor,
    details: Details as unknown as ElementConstructor,
    summary: Summary as unknown as ElementConstructor,
    hgroup: Hgroup as unknown as ElementConstructor,
    dl: Dl as unknown as ElementConstructor,
    dt: Dt as unknown as ElementConstructor,
    dd: Dd as unknown as ElementConstructor,
    form: Form as unknown as ElementConstructor,
    fieldset: Fieldset as unknown as ElementConstructor,
    legend: Legend as unknown as ElementConstructor,
    picture: Picture as unknown as ElementConstructor,
    hr: Hr as unknown as ElementConstructor,
    link: Link as unknown as ElementConstructor,

    // Text & phrasing elements
    p: P as unknown as ElementConstructor,
    span: Span as unknown as ElementConstructor,
    code: Code as unknown as ElementConstructor,
    blockquote: Blockquote as unknown as ElementConstructor,
    b: B as unknown as ElementConstructor,
    strong: Strong as unknown as ElementConstructor,
    pre: Pre as unknown as ElementConstructor,
    em: Em as unknown as ElementConstructor,
    i: I as unknown as ElementConstructor,
    small: Small as unknown as ElementConstructor,
    mark: Mark as unknown as ElementConstructor,
    sub: Sub as unknown as ElementConstructor,
    sup: Sup as unknown as ElementConstructor,
    u: U as unknown as ElementConstructor,
    ins: Ins as unknown as ElementConstructor,
    s: S as unknown as ElementConstructor,
    del: Del as unknown as ElementConstructor,
    abbr: Abbr as unknown as ElementConstructor,
    cite: Cite as unknown as ElementConstructor,
    dfn: Dfn as unknown as ElementConstructor,
    q: Q as unknown as ElementConstructor,
    samp: Samp as unknown as ElementConstructor,
    var: Var as unknown as ElementConstructor,
    time: Time as unknown as ElementConstructor,
    output: Output as unknown as ElementConstructor,
    bdi: Bdi as unknown as ElementConstructor,
    bdo: Bdo as unknown as ElementConstructor,

    // Replaced / interactive controls
    img: Img as unknown as ElementConstructor,
    input: Input as unknown as ElementConstructor,
    textarea: TextArea as unknown as ElementConstructor,
    br: Br as unknown as ElementConstructor,
  };

  for (const tag of BLOCK_OVERRIDE_TAGS) {
    registry[tag] = makeBlockElement(tag);
  }

  return registry;
};

let cachedRegistry: Record<string, ElementConstructor> | undefined;

export const getDefaultElementRegistry = (): Readonly<Record<string, ElementConstructor>> => {
  cachedRegistry ??= buildDefaultRegistry();
  return cachedRegistry;
};

const tagNames = new WeakMap<object, string>();

export const getTagName = (node: MasonNode): string | undefined => {
  if (isTextNode(node)) return '#text';
  if (isContainer(node)) return '#container';
  return tagNames.get(node) ?? (node as { cssType?: string }).cssType?.toLowerCase();
};

export const setTagName = (node: NSView, tag: string): void => {
  tagNames.set(node, tag.toLowerCase());
};

/**
 * Instantiates a MasonKit view for an HTML tag name, falling back to a
 * `@CSSType(tag)` `Div` for custom or unknown elements.
 */
export function createMasonElement(
  tag: string,
  overrides?: Readonly<Record<string, ElementConstructor>> | undefined,
): NSView {
  const normalized = tag.toLowerCase();
  const Ctor =
    overrides?.[normalized] ??
    overrides?.[tag] ??
    getDefaultElementRegistry()[normalized] ??
    makeBlockElement(normalized);
  const view = new Ctor();
  setTagName(view, normalized);

  // Give buttons accessible tap feedback defaults without overriding stylesheets.
  if (normalized === 'button') {
    (view as unknown as Record<string, unknown>)['type'] = 'submit';
  }
  return view;
}
