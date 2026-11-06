// T09 — server-safe render + editor (canvas preview + settings) tests for the
// question block catalog (spec §7.2). All markup goes through BlockView /
// registered Render components with react-dom/server (no browser needed).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BlockView } from "./view";
// Importing the block modules registers them (spec §7.1 import-time registry).
import "./email";
import "./number";
import "./long-text";
import "./single-select";
import "./multi-select";
import "./dropdown";
import "./rating";
import "./nps";
import { DropdownEditor } from "./dropdown/editor";
import { dropdownDefaultProps } from "./dropdown/schema";
import { EmailEditor } from "./email/editor";
import { emailDefaultProps } from "./email/schema";
import { LongTextEditor } from "./long-text/editor";
import { longTextDefaultProps } from "./long-text/schema";
import { MultiSelectEditor } from "./multi-select/editor";
import { multiSelectDefaultProps } from "./multi-select/schema";
import { NpsEditor } from "./nps/editor";
import { npsDefaultProps } from "./nps/schema";
import { NumberEditor } from "./number/editor";
import { numberDefaultProps } from "./number/schema";
import { RatingEditor } from "./rating/editor";
import { ratingDefaultProps } from "./rating/schema";
import { SingleSelectEditor } from "./single-select/editor";
import { singleSelectDefaultProps } from "./single-select/schema";

const markup = (element: React.ReactNode): string => renderToStaticMarkup(element);
const noop = (): void => {};

describe("question renders (server-safe, via BlockView)", () => {
  it("email renders an email input and marks required", () => {
    const html = markup(
      <BlockView
        block={{
          id: "blk_email001",
          kind: "email",
          props: { ...emailDefaultProps(), required: true },
        }}
      />,
    );
    expect(html).toContain('data-block-kind="email"');
    expect(html).toContain('type="email"');
    expect(html).toContain("Email address");
    expect(html).toContain("*");
  });

  it("number renders min/max attributes from props", () => {
    const html = markup(
      <BlockView
        block={{
          id: "blk_num00001",
          kind: "number",
          props: { ...numberDefaultProps(), min: 1, max: 10 },
        }}
      />,
    );
    expect(html).toContain('data-block-kind="number"');
    expect(html).toContain('type="number"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="10"');
  });

  it("long-text renders a textarea with placeholder", () => {
    const html = markup(
      <BlockView
        block={{
          id: "blk_long0001",
          kind: "long-text",
          props: { ...longTextDefaultProps(), placeholder: "Tell us more" },
        }}
      />,
    );
    expect(html).toContain('data-block-kind="long-text"');
    expect(html).toContain("<textarea");
    expect(html).toContain("Tell us more");
  });

  it("single-select renders one radio per option; allowOther adds an Other input", () => {
    const props = singleSelectDefaultProps();
    const html = markup(
      <BlockView block={{ id: "blk_single01", kind: "single-select", props }} />,
    );
    expect(html).toContain('data-block-kind="single-select"');
    expect((html.match(/type="radio"/g) ?? []).length).toBe(2);
    expect(html).toContain("Option 1");
    expect(html).not.toContain("Other");

    const withOther = markup(
      <BlockView
        block={{
          id: "blk_single01",
          kind: "single-select",
          props: { ...props, allowOther: true },
        }}
      />,
    );
    expect(withOther).toContain("Other");
    expect(withOther).toContain('type="text"');
  });

  it("single-select randomize keeps exactly the same option set", () => {
    const props = { ...singleSelectDefaultProps(), randomize: true };
    const html = markup(<BlockView block={{ id: "blk_single02", kind: "single-select", props }} />);
    expect(html).toContain("Option 1");
    expect(html).toContain("Option 2");
    expect((html.match(/type="radio"/g) ?? []).length).toBe(2);
  });

  it("single-select shows an existing {other} answer", () => {
    const html = markup(
      <BlockView
        block={{
          id: "blk_single03",
          kind: "single-select",
          props: { ...singleSelectDefaultProps(), allowOther: true },
        }}
        answer={{ other: "custom answer" }}
      />,
    );
    expect(html).toContain('value="custom answer"');
  });

  it("multi-select renders checkboxes and checks stored optionIds", () => {
    const props = multiSelectDefaultProps();
    const id1 = props.options[0]?.id ?? "";
    const html = markup(<BlockView block={{ id: "blk_multi001", kind: "multi-select", props }} />);
    expect(html).toContain('data-block-kind="multi-select"');
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(2);

    const answered = markup(
      <BlockView
        block={{ id: "blk_multi001", kind: "multi-select", props }}
        answer={{ optionIds: [id1] }}
      />,
    );
    expect(answered).toContain("checked");
  });

  it("dropdown renders a select with options; searchable flag is observable", () => {
    const props = dropdownDefaultProps();
    const html = markup(<BlockView block={{ id: "blk_drop0001", kind: "dropdown", props }} />);
    expect(html).toContain('data-block-kind="dropdown"');
    expect(html).toContain("<select");
    expect(html).toContain("Option 1");
    expect(html).toContain('data-searchable="false"');

    const searchable = markup(
      <BlockView
        block={{ id: "blk_drop0001", kind: "dropdown", props: { ...props, searchable: true } }}
      />,
    );
    expect(searchable).toContain('data-searchable="true"');
  });

  it("rating renders exactly `scale` choices with the configured icon", () => {
    const html = markup(
      <BlockView
        block={{
          id: "blk_rating01",
          kind: "rating",
          props: { ...ratingDefaultProps(), scale: 4, icon: "heart" },
        }}
      />,
    );
    expect(html).toContain('data-block-kind="rating"');
    expect(html).toContain('data-scale="4"');
    expect(html).toContain('data-icon="heart"');
    expect((html.match(/♥/g) ?? []).length).toBe(4);
    expect(html).toContain("aria-checked=\"false\"");
  });

  it("nps renders 0–10 buttons plus left/right labels and marks the stored score", () => {
    const html = markup(
      <BlockView
        block={{ id: "blk_nps00001", kind: "nps", props: npsDefaultProps() }}
        answer={7}
      />,
    );
    expect(html).toContain('data-block-kind="nps"');
    expect(html).toContain("Not likely");
    expect(html).toContain("Very likely");
    expect((html.match(/type="button"/g) ?? []).length).toBe(11);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('data-value="7"');
  });
});

describe("prefillParam prefills the render preview (acceptance)", () => {
  it("email render prefills from urlParams when no answer is set", () => {
    const props = { ...emailDefaultProps(), prefillParam: "email" as const };
    const html = markup(
      <BlockView
        block={{ id: "blk_email002", kind: "email", props }}
        urlParams={{ email: "ada@example.com" }}
      />,
    );
    expect(html).toContain('value="ada@example.com"');
  });

  it("an explicit answer wins over the URL param", () => {
    const props = { ...emailDefaultProps(), prefillParam: "email" as const };
    const html = markup(
      <BlockView
        block={{ id: "blk_email002", kind: "email", props }}
        urlParams={{ email: "from-url@example.com" }}
        answer="explicit@example.com"
      />,
    );
    expect(html).toContain('value="explicit@example.com"');
    expect(html).not.toContain("from-url@example.com");
  });

  it("nps prefill clamps into 0–10 before display", () => {
    const props = { ...npsDefaultProps(), prefillParam: "score" as const };
    const html = markup(
      <BlockView
        block={{ id: "blk_nps00002", kind: "nps", props }}
        urlParams={{ score: "99" }}
      />,
    );
    expect(html).toContain('data-value="10"');
  });

  it("single-select prefill matches by label and stores {optionId}", () => {
    const props = { ...singleSelectDefaultProps(), prefillParam: "pick" as const };
    const html = markup(
      <BlockView
        block={{ id: "blk_single04", kind: "single-select", props }}
        urlParams={{ pick: "Option 2" }}
      />,
    );
    expect(html).toContain('checked');
    expect(html).toContain("Option 2");
  });
});

describe("editors: canvas preview + settings (acceptance: canvas preview + settings)", () => {
  it("email editor renders canvas preview and settings fields", () => {
    const html = markup(
      <EmailEditor blockId="blk_email001" props={emailDefaultProps()} onChange={noop} />,
    );
    expect(html).toContain('data-kind="email"');
    expect(html).toContain('data-editor-canvas="email"');
    expect(html).toContain('data-block-kind="email"'); // canvas shows the render preview
    expect(html).toContain("Label");
    expect(html).toContain("Required");
    expect(html).toContain("Description");
    expect(html).toContain("Button text");
    expect(html).toContain("Image asset");
    expect(html).toContain("Prefill param");
  });

  it("email editor canvas is prefilled from urlParams (acceptance: prefillParam prefills editor-canvas)", () => {
    const props = { ...emailDefaultProps(), prefillParam: "email" as const };
    const html = markup(
      <EmailEditor blockId="blk_email001" props={props} urlParams={{ email: "ada@example.com" }} onChange={noop} />,
    );
    expect(html).toContain('value="ada@example.com"');
  });

  it("number editor exposes min/max fields", () => {
    const html = markup(<NumberEditor blockId="blk_num00001" props={numberDefaultProps()} onChange={noop} />);
    expect(html).toContain('data-editor-canvas="number"');
    expect(html).toContain("Min");
    expect(html).toContain("Max");
  });

  it("long-text editor exposes placeholder + maxLength fields", () => {
    const html = markup(<LongTextEditor blockId="blk_long0001" props={longTextDefaultProps()} onChange={noop} />);
    expect(html).toContain('data-editor-canvas="long-text"');
    expect(html).toContain("Placeholder");
    expect(html).toContain("Max length");
  });

  it("single-select editor exposes options, allowOther and randomize", () => {
    const html = markup(<SingleSelectEditor blockId="blk_single01" props={singleSelectDefaultProps()} onChange={noop} />);
    expect(html).toContain('data-editor-canvas="single-select"');
    expect(html).toContain("Allow other");
    expect(html).toContain("Randomize");
    expect(html).toContain("Add option");
  });

  it("multi-select editor exposes options and min/max", () => {
    const html = markup(<MultiSelectEditor blockId="blk_multi001" props={multiSelectDefaultProps()} onChange={noop} />);
    expect(html).toContain('data-editor-canvas="multi-select"');
    expect(html).toContain("Min selections");
    expect(html).toContain("Max selections");
  });

  it("dropdown editor exposes options and searchable", () => {
    const html = markup(<DropdownEditor blockId="blk_drop0001" props={dropdownDefaultProps()} onChange={noop} />);
    expect(html).toContain('data-editor-canvas="dropdown"');
    expect(html).toContain("Searchable");
  });

  it("rating editor exposes scale + icon", () => {
    const html = markup(<RatingEditor blockId="blk_rating01" props={ratingDefaultProps()} onChange={noop} />);
    expect(html).toContain('data-editor-canvas="rating"');
    expect(html).toContain("Scale");
    expect(html).toContain("Icon");
  });

  it("nps editor exposes left/right labels", () => {
    const html = markup(<NpsEditor blockId="blk_nps00001" props={npsDefaultProps()} onChange={noop} />);
    expect(html).toContain('data-editor-canvas="nps"');
    expect(html).toContain("Left label");
    expect(html).toContain("Right label");
  });
});
