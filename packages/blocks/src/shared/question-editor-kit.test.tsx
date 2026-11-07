// §9.1/§10 — question-editor-kit image row + asset-picker host seam.
// Static-render tests (node env, no jsdom — the package's test posture) for
// markup, plus direct seam contract tests for the host registration.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GenericQuestionFields, pickImageAsset, setAssetPickerOpener } from "./question-editor-kit";

function renderFields(props: { imageAssetId?: string } = {}, disabled = false): string {
  return renderToStaticMarkup(
    h(GenericQuestionFields, {
      props: { required: false, ...props },
      onPatch: () => {},
      disabled,
    }),
  );
}

afterEach(() => {
  setAssetPickerOpener(null);
});

describe("GenericQuestionFields image row (§9.1)", () => {
  it("renders the image row: manual id input + the §10 Choose image… button", () => {
    const html = renderFields();
    expect(html).toContain("Image asset");
    expect(html).toContain('data-image-row');
    expect(html).toContain('aria-label="Image asset id"');
    expect(html).toContain("Choose image…");
  });

  it("shows the current reference and a remove button only when one is set", () => {
    const html = renderFields({ imageAssetId: "ast_0001" });
    expect(html).toContain('value="ast_0001"');
    expect(html).toContain('aria-label="Remove image"');
    expect(renderFields()).not.toContain('aria-label="Remove image"');
  });

  it("disables the row controls with the editor", () => {
    const html = renderFields({ imageAssetId: "ast_0001" }, true);
    expect(html).toContain("disabled");
    expect(html).toContain('aria-label="Remove image"');
    expect(html).toContain('>Choose image…</button>');
  });
});

describe("asset-picker host seam (§10)", () => {
  it("pickImageAsset resolves through the registered opener with supportsAlt", async () => {
    const opener = vi.fn(async () => ({ assetId: "ast_0001" }));
    setAssetPickerOpener(opener);
    await expect(pickImageAsset(false)).resolves.toEqual({ assetId: "ast_0001" });
    expect(opener).toHaveBeenCalledWith({ supportsAlt: false });
  });

  it("passes supportsAlt through (gallery ImageAssetRef records store alt)", async () => {
    const opener = vi.fn(async () => ({ assetId: "ast_0002", alt: "Team offsite" }));
    setAssetPickerOpener(opener);
    await expect(pickImageAsset(true)).resolves.toEqual({ assetId: "ast_0002", alt: "Team offsite" });
    expect(opener).toHaveBeenCalledWith({ supportsAlt: true });
  });

  it("resolves null with no host registered (manual-edit fallback, never throws)", async () => {
    setAssetPickerOpener(null);
    await expect(pickImageAsset(false)).resolves.toBeNull();
  });

  it("resolves null when the host is registered and the user cancels", async () => {
    setAssetPickerOpener(async () => null);
    await expect(pickImageAsset(false)).resolves.toBeNull();
  });
});
