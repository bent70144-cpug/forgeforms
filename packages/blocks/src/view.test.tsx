import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FC, ReactNode } from "react";
import { z } from "zod";
import { BlockView } from "./view";
import { registerBlock, type BlockDef, type EditorProps, type RenderProps } from "./registry";
import { buttonBlock } from "./button";
import { heroBlock } from "./hero";
import { shortTextBlock } from "./short-text";
import {
  buttonBlockFixture,
  heroBlockFixture,
  shortTextBlockFixture,
} from "./fixtures";

// Local layout stub so children rendering can be exercised end-to-end.
const StackEditor: FC<EditorProps<Record<string, never>>> = () => null;
const StackRender: FC<RenderProps<Record<string, never>>> = ({ children }) => (
  <div className="ff-stack" data-block-kind="_test-stack">
    {children}
  </div>
);
const stackDef: BlockDef<Record<string, never>> = {
  kind: "_test-stack",
  family: "layout",
  label: "Stack",
  icon: "layers",
  propsSchema: z.strictObject({}),
  defaultProps: () => ({}),
  Editor: StackEditor,
  Render: StackRender,
};
registerBlock(stackDef);

const markup = (element: ReactNode): string => renderToStaticMarkup(element);

describe("BlockView render tests (acceptance: 3 blocks render valid markup from defaultProps)", () => {
  it("hero renders title, subtitle and cta from its default props", () => {
    const html = markup(
      <BlockView block={{ id: "blk_hero001", kind: "hero", props: heroBlock.defaultProps() }} />,
    );
    expect(html).toContain('data-block-kind="hero"');
    expect(html).toContain("<h1");
    expect(html).toContain("Hero title");
    expect(html).not.toContain("ff-hero__cta"); // defaultProps have no cta
  });

  it("hero renders a cta link when present", () => {
    const html = markup(
      <BlockView
        block={{
          id: "blk_hero001",
          kind: "hero",
          props: { ...heroBlock.defaultProps(), cta: { label: "Get started", href: "/signup" } },
        }}
      />,
    );
    expect(html).toContain('href="/signup"');
    expect(html).toContain("Get started");
  });

  it("short-text renders a labelled input from its default props", () => {
    const html = markup(
      <BlockView
        block={{ id: "blk_text0001", kind: "short-text", props: shortTextBlock.defaultProps() }}
      />,
    );
    expect(html).toContain('data-block-kind="short-text"');
    expect(html).toContain("<label");
    expect(html).toContain("<input");
    expect(html).toContain("Short answer");
  });

  it("short-text marks required questions", () => {
    const html = markup(
      <BlockView
        block={{
          id: "blk_text0001",
          kind: "short-text",
          props: { ...shortTextBlock.defaultProps(), required: true },
        }}
      />,
    );
    expect(html).toContain("*");
  });

  it("button renders an anchor with style class from its default props", () => {
    const html = markup(
      <BlockView block={{ id: "blk_button01", kind: "button", props: buttonBlock.defaultProps() }} />,
    );
    expect(html).toContain('class="ff-button ff-button--primary"');
    expect(html).toContain('href="#"');
    expect(html).toContain("Button");
  });

  it("collapses javascript: hrefs to # (renderer never emits script URLs)", () => {
    const html = markup(
      <BlockView
        block={{ id: "blk_button01", kind: "button", props: { label: "X", href: "javascript:alert(1)" } }}
      />,
    );
    expect(html).toContain('href="#"');
    expect(html).not.toContain("javascript:");
  });
});

describe("BlockView registry rules (spec §7.1)", () => {
  it("renders an unknown kind as nothing without throwing", () => {
    const html = markup(
      <BlockView block={{ id: "blk_nope0001", kind: "marquee", props: {} }} />,
    );
    expect(html).toBe("");
  });

  it("renders invalid stored props as nothing without throwing", () => {
    const html = markup(
      <BlockView block={{ id: "blk_hero001", kind: "hero", props: { title: 42 } }} />,
    );
    expect(html).toBe("");
  });

  it("renders a hidden block as nothing", () => {
    const html = markup(
      <BlockView
        block={{ id: "blk_button01", kind: "button", props: buttonBlock.defaultProps(), hidden: true }}
      />,
    );
    expect(html).toBe("");
  });

  it("renders children recursively through layout blocks", () => {
    const html = markup(
      <BlockView
        block={{
          id: "blk_stack001",
          kind: "_test-stack",
          props: {},
          children: [heroBlockFixture(), shortTextBlockFixture(), buttonBlockFixture()],
        }}
      />,
    );
    expect(html).toContain('data-block-kind="_test-stack"');
    expect(html).toContain('data-block-kind="hero"');
    expect(html).toContain('data-block-kind="short-text"');
    expect(html).toContain('data-block-kind="button"');
  });

  it("skips unknown children without crashing the parent", () => {
    const html = markup(
      <BlockView
        block={{
          id: "blk_stack002",
          kind: "_test-stack",
          props: {},
          children: [
            { id: "blk_nope0001", kind: "marquee", props: {} },
            buttonBlockFixture(),
          ],
        }}
      />,
    );
    expect(html).toContain('data-block-kind="button"');
    expect(html).not.toContain("marquee");
  });
});
