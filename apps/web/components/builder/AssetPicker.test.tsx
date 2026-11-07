// §10 AssetPicker — jsdom live tests (mock fetch only: no S3, no DB).
// Covers: tabs render, the upload flow (presign → PUT → confirm) success +
// failure states, the §10 alt-text prompt, the Library list (render,
// selection, scan-state gating), the asset-picker bridge contract, and the
// §9.1 chain question-editor-kit image row → seam → picker → stored reference.
// @vitest-environment jsdom
import { act } from "react";
import { createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GenericQuestionFields,
  GalleryEditor,
  GalleryProps,
  galleryDefaultProps,
  setAssetPickerOpener,
} from "@formforge/blocks";
import { AssetPicker, type AssetPickerProps } from "./AssetPicker";
import { useAssetPicker } from "./useAssetPicker";
import {
  OPEN_ASSET_PICKER_EVENT,
  requestAssetPick,
  settleAssetPicker,
  type OpenAssetPickerDetail,
} from "./asset-picker-bridge";
import type { FetchLike } from "@/lib/assets/client";

// React 19: act() requires the test environment to opt in explicitly.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Harness (createRoot + act — no @testing-library in this repo)
// ---------------------------------------------------------------------------

let container: HTMLElement | null = null;
let root: Root | null = null;

function render(ui: React.ReactNode): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(ui);
  });
  return container;
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  setAssetPickerOpener(null);
  vi.restoreAllMocks();
});

/** Flush pending promises/state until the assertion holds (or time out). */
async function waitFor(assert: () => void, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assert();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

function byTestId(el: HTMLElement, testId: string): HTMLElement {
  const found = el.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!found) throw new Error(`missing [data-testid="${testId}"]`);
  return found;
}

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function setInputFiles(el: HTMLInputElement, files: File[]): void {
  Object.defineProperty(el, "files", { value: files, configurable: true });
  act(() => {
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// ---------------------------------------------------------------------------
// Mock fetch routing (v1 contracts from app/api/v1/assets/*)
// ---------------------------------------------------------------------------

const PRESIGN_OK = {
  assetId: "ast_new1",
  key: "media/ws_1/ast_new1/hero.png",
  uploadUrl: "https://s3.test/put/ast_new1",
  mime: "image/png",
  maxSizeMb: 10,
  expiresInSeconds: 600,
  scanStatus: "pending",
};

const CONFIRM_OK = { assetId: "ast_new1", key: "media/ws_1/ast_new1/hero.png", mime: "image/png", scanStatus: "pending" };

type Route = (url: string, init?: RequestInit) => { status: number; body?: unknown } | undefined;

function fetchRouter(route: Route): { fetchImpl: FetchLike; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = (input, init) => {
    calls.push({ url: input, init });
    const matched = route(input, init);
    if (!matched) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "unrouted" } }), { status: 404 }),
      );
    }
    return Promise.resolve(
      new Response(matched.body === undefined ? "" : JSON.stringify(matched.body), {
        status: matched.status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { fetchImpl, calls };
}

const UPLOAD_ROUTES: Route = (url, init) => {
  if (url === "/api/v1/assets/presign" && init?.method === "POST") return { status: 200, body: PRESIGN_OK };
  if (url === PRESIGN_OK.uploadUrl && init?.method === "PUT") return { status: 200 };
  if (url === "/api/v1/assets/confirm" && init?.method === "POST") return { status: 200, body: CONFIRM_OK };
  if (url.startsWith("/api/v1/assets?")) return { status: 200, body: { data: [], nextCursor: null } };
  return undefined;
};

function pickerProps(overrides: Partial<AssetPickerProps> = {}): AssetPickerProps {
  return {
    open: true,
    onClose: () => {},
    onSelect: () => {},
    fetchImpl: fetchRouter(UPLOAD_ROUTES).fetchImpl,
    ...overrides,
  };
}

function imageFile(name = "hero.png"): File {
  return new File(["bytes"], name, { type: "image/png" });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("<AssetPicker> chrome (§10 + §12 a11y)", () => {
  it("renders nothing when closed", () => {
    const el = render(h(AssetPicker, pickerProps({ open: false })));
    expect(el.querySelector('[data-testid="ff-asset-picker"]')).toBeNull();
  });

  it("renders a labelled modal dialog with Upload | Library tabs", () => {
    const el = render(h(AssetPicker, pickerProps()));
    const dialog = byTestId(el, "ff-asset-picker");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Choose an image");
    const uploadTab = byTestId(el, "ff-asset-tab-upload");
    const libraryTab = byTestId(el, "ff-asset-tab-library");
    expect(uploadTab.getAttribute("aria-selected")).toBe("true");
    expect(libraryTab.getAttribute("aria-selected")).toBe("false");
    expect(byTestId(el, "ff-asset-upload")).not.toBeNull();
  });

  it("switches to the Library tab on click", async () => {
    const el = render(h(AssetPicker, pickerProps()));
    click(byTestId(el, "ff-asset-tab-library"));
    expect(byTestId(el, "ff-asset-library")).not.toBeNull();
  });
});

describe("<AssetPicker> upload flow (mocked presign/PUT/confirm)", () => {
  it("runs presign → PUT → confirm and shows the scan-pending state, then resolves on Use image", async () => {
    const onSelect = vi.fn();
    const { fetchImpl, calls } = fetchRouter(UPLOAD_ROUTES);
    const el = render(h(AssetPicker, pickerProps({ onSelect, fetchImpl })));

    setInputFiles(byTestId(el, "ff-asset-file-input") as HTMLInputElement, [imageFile()]);

    await waitFor(() => {
      expect(byTestId(el, "ff-asset-upload-status").textContent).toContain("malware scan pending");
    });
    // The first call is the on-open Library list; then the three upload steps.
    expect(calls.map((c) => c.url)).toEqual([
      "/api/v1/assets?purpose=media&limit=50",
      "/api/v1/assets/presign",
      PRESIGN_OK.uploadUrl,
      "/api/v1/assets/confirm",
    ]);

    click(byTestId(el, "ff-asset-use-image"));
    expect(onSelect).toHaveBeenCalledWith({ assetId: "ast_new1" });
  });

  it("rejects non-image files before any request", () => {
    const onSelect = vi.fn();
    const { fetchImpl, calls } = fetchRouter(UPLOAD_ROUTES);
    const el = render(h(AssetPicker, pickerProps({ onSelect, fetchImpl })));
    setInputFiles(byTestId(el, "ff-asset-file-input") as HTMLInputElement, [
      new File(["x"], "evil.exe", { type: "application/x-msdownload" }),
    ]);
    expect(byTestId(el, "ff-asset-upload-error").textContent).toContain("Only image files");
    // Only the on-open Library list ran — presign never called.
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/assets?purpose=media&limit=50"]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows the §4 error message when presign fails and never confirms", async () => {
    const onSelect = vi.fn();
    const { fetchImpl, calls } = fetchRouter((url) =>
      url === "/api/v1/assets/presign"
        ? {
            status: 422,
            body: { error: { code: "VALIDATION", message: "File exceeds the 10 MB upload limit" } },
          }
        : undefined,
    );
    const el = render(h(AssetPicker, pickerProps({ onSelect, fetchImpl })));
    setInputFiles(byTestId(el, "ff-asset-file-input") as HTMLInputElement, [imageFile()]);
    await waitFor(() => {
      expect(byTestId(el, "ff-asset-upload-error").textContent).toContain("File exceeds the 10 MB upload limit");
    });
    expect(calls.map((c) => c.url)).toEqual([
      "/api/v1/assets?purpose=media&limit=50",
      "/api/v1/assets/presign",
    ]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows an alert when the storage PUT fails", async () => {
    const onSelect = vi.fn();
    const { fetchImpl } = fetchRouter((url) =>
      url === "/api/v1/assets/presign" ? { status: 200, body: PRESIGN_OK } : url === PRESIGN_OK.uploadUrl ? { status: 500 } : undefined,
    );
    const el = render(h(AssetPicker, pickerProps({ onSelect, fetchImpl })));
    setInputFiles(byTestId(el, "ff-asset-file-input") as HTMLInputElement, [imageFile()]);
    await waitFor(() => {
      expect(byTestId(el, "ff-asset-upload-error").textContent).toContain("could not be stored");
    });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("<AssetPicker> §10 alt-text prompt (target prop supports alt)", () => {
  it("prompts for alt after upload; Save resolves with the alt text", async () => {
    const onSelect = vi.fn();
    const el = render(h(AssetPicker, pickerProps({ onSelect, supportsAlt: true })));
    setInputFiles(byTestId(el, "ff-asset-file-input") as HTMLInputElement, [imageFile()]);
    await waitFor(() => {
      expect(byTestId(el, "ff-asset-alt-input")).not.toBeNull();
    });
    // scan-pending note stays visible inside the alt step (§10 honest state).
    expect(byTestId(el, "ff-asset-scan-pending").textContent).toContain("malware scan pending");
    typeInto(byTestId(el, "ff-asset-alt-input") as HTMLInputElement, "Team offsite photo");
    click(byTestId(el, "ff-asset-alt-save"));
    expect(onSelect).toHaveBeenCalledWith({ assetId: "ast_new1", alt: "Team offsite photo" });
  });

  it("Skip resolves without alt text", async () => {
    const onSelect = vi.fn();
    const el = render(h(AssetPicker, pickerProps({ onSelect, supportsAlt: true })));
    setInputFiles(byTestId(el, "ff-asset-file-input") as HTMLInputElement, [imageFile()]);
    await waitFor(() => {
      expect(byTestId(el, "ff-asset-alt-input")).not.toBeNull();
    });
    click(byTestId(el, "ff-asset-alt-skip"));
    expect(onSelect).toHaveBeenCalledWith({ assetId: "ast_new1" });
  });

  it("no alt step for string-only target props (question imageAssetId)", async () => {
    const onSelect = vi.fn();
    const el = render(h(AssetPicker, pickerProps({ onSelect, supportsAlt: false })));
    setInputFiles(byTestId(el, "ff-asset-file-input") as HTMLInputElement, [imageFile()]);
    await waitFor(() => {
      expect(byTestId(el, "ff-asset-use-image")).not.toBeNull();
    });
    expect(el.querySelector('[data-testid="ff-asset-alt-input"]')).toBeNull();
  });
});

describe("<AssetPicker> library (GET /api/v1/assets)", () => {
  const ITEMS = {
    data: [
      {
        asset: { id: "ast_a", key: "media/ws_1/ast_a/hero.png", mime: "image/png", sizeBytes: 1, purpose: "media", scanStatus: "skipped", variants: null, createdAt: "2026-11-06T00:00:00.000Z" },
        download: { url: "https://s3.test/get/ast_a", expiresInSeconds: 3600 },
      },
      {
        asset: { id: "ast_b", key: "media/ws_1/ast_b/scan.png", mime: "image/png", sizeBytes: 2, purpose: "media", scanStatus: "pending", variants: null, createdAt: "2026-11-06T00:00:00.000Z" },
        download: null,
      },
      {
        asset: { id: "ast_c", key: "media/ws_1/ast_c/bad.png", mime: "image/png", sizeBytes: 3, purpose: "media", scanStatus: "infected", variants: null, createdAt: "2026-11-06T00:00:00.000Z" },
        download: null,
      },
    ],
    nextCursor: null,
  };

  it("lists workspace assets with scan-state labels; only servable rows selectable", async () => {
    const onSelect = vi.fn();
    const { fetchImpl } = fetchRouter((url) =>
      url.startsWith("/api/v1/assets?") ? { status: 200, body: ITEMS } : undefined,
    );
    const el = render(h(AssetPicker, pickerProps({ onSelect, fetchImpl })));
    click(byTestId(el, "ff-asset-tab-library"));
    await waitFor(() => {
      expect(el.querySelectorAll('[data-testid="ff-asset-item"]')).toHaveLength(3);
    });
    const rows = el.querySelectorAll<HTMLButtonElement>('[data-testid="ff-asset-item"]');
    expect(rows[0]!.disabled).toBe(false);
    expect(rows[1]!.disabled).toBe(true); // pending → not servable (§17)
    expect(rows[2]!.disabled).toBe(true); // infected → blocked
    click(rows[0]!);
    expect(onSelect).toHaveBeenCalledWith({ assetId: "ast_a" });
  });

  it("shows the empty state before any upload", async () => {
    const { fetchImpl } = fetchRouter((url) =>
      url.startsWith("/api/v1/assets?") ? { status: 200, body: { data: [], nextCursor: null } } : undefined,
    );
    const el = render(h(AssetPicker, pickerProps({ fetchImpl })));
    click(byTestId(el, "ff-asset-tab-library"));
    await waitFor(() => {
      expect(byTestId(el, "ff-asset-library-empty").textContent).toContain("No images yet");
    });
  });

  it("shows an alert when the list fails", async () => {
    const { fetchImpl } = fetchRouter((url) =>
      url.startsWith("/api/v1/assets?")
        ? { status: 500, body: { error: { code: "INTERNAL", message: "Internal error" } } }
        : undefined,
    );
    const el = render(h(AssetPicker, pickerProps({ fetchImpl })));
    click(byTestId(el, "ff-asset-tab-library"));
    await waitFor(() => {
      expect(byTestId(el, "ff-asset-library-error").textContent).toContain("Internal error");
    });
  });
});

// ---------------------------------------------------------------------------
// Bridge contract (ff:open-asset-picker)
// ---------------------------------------------------------------------------

describe("asset-picker bridge", () => {
  it("requestAssetPick dispatches the event and settleAssetPicker resolves the promise", async () => {
    const seen: OpenAssetPickerDetail[] = [];
    const listener = (event: Event): void => {
      seen.push((event as CustomEvent<OpenAssetPickerDetail>).detail ?? {});
    };
    window.addEventListener(OPEN_ASSET_PICKER_EVENT, listener);
    const promise = requestAssetPick({ supportsAlt: true });
    expect(seen).toEqual([{ supportsAlt: true }]);
    settleAssetPicker({ assetId: "ast_1", alt: "x" });
    await expect(promise).resolves.toEqual({ assetId: "ast_1", alt: "x" });
    window.removeEventListener(OPEN_ASSET_PICKER_EVENT, listener);
  });

  it("cancelling resolves null; a superseded request resolves the old one null", async () => {
    const first = requestAssetPick();
    const second = requestAssetPick({ supportsAlt: false });
    await expect(first).resolves.toBeNull(); // superseded
    settleAssetPicker(null);
    await expect(second).resolves.toBeNull(); // cancelled by close
  });
});

// ---------------------------------------------------------------------------
// §9.1 chains: question-editor-kit image row + gallery Add image…
// ---------------------------------------------------------------------------

describe("question-editor-kit image row → picker → stored reference (§9.1)", () => {
  it("Choose image… stores the picked reference into imageAssetId via a fake opener", async () => {
    setAssetPickerOpener(vi.fn(async () => ({ assetId: "ast_kit1" })));
    const onPatch = vi.fn();
    const el = render(
      h(GenericQuestionFields, { props: { required: false }, onPatch }),
    );
    const choose = el.querySelector<HTMLButtonElement>(".ff-editor__image-choose");
    expect(choose).not.toBeNull();
    click(choose!);
    await waitFor(() => {
      expect(onPatch).toHaveBeenCalledWith({ imageAssetId: "ast_kit1" });
    });
  });

  it("full chain: kit row → bridge event → hosted modal (library pick) → patch", async () => {
    // Register the same seam wiring BuilderPage's bridge module installs.
    setAssetPickerOpener((options) => requestAssetPick(options));
    const onPatch = vi.fn();
    const { fetchImpl } = fetchRouter((url) =>
      url.startsWith("/api/v1/assets?")
        ? {
            status: 200,
            body: {
              data: [
                {
                  asset: { id: "ast_lib1", key: "media/ws_1/ast_lib1/pic.png", mime: "image/png", sizeBytes: 1, purpose: "media", scanStatus: "clean", variants: null, createdAt: "2026-11-06T00:00:00.000Z" },
                  download: { url: "https://s3.test/get/ast_lib1", expiresInSeconds: 3600 },
                },
              ],
              nextCursor: null,
            },
          }
        : undefined,
    );

    function Host(): React.ReactNode {
      const picker = useAssetPicker();
      return h(AssetPicker, {
        open: picker.request !== null,
        supportsAlt: picker.request?.supportsAlt === true,
        onClose: picker.close,
        onSelect: picker.select,
        fetchImpl,
      });
    }
    const el = render(
      h(
        "div",
        null,
        h(GenericQuestionFields, { props: { required: false }, onPatch }),
        h(Host),
      ),
    );

    const choose = el.querySelector<HTMLButtonElement>(".ff-editor__image-choose")!;
    click(choose); // dispatches ff:open-asset-picker → host opens the modal
    await waitFor(() => {
      expect(byTestId(el, "ff-asset-picker")).not.toBeNull();
    });
    // The question row does NOT support alt (plain string prop) → no alt step.
    expect(el.querySelector('[data-testid="ff-asset-alt-input"]')).toBeNull();
    click(byTestId(el, "ff-asset-tab-library"));
    await waitFor(() => {
      expect(el.querySelectorAll('[data-testid="ff-asset-item"]')).toHaveLength(1);
    });
    click(el.querySelector<HTMLButtonElement>('[data-testid="ff-asset-item"]')!);
    await waitFor(() => {
      expect(onPatch).toHaveBeenCalledWith({ imageAssetId: "ast_lib1" });
    });
  });

  it("gallery Add image… appends the picked reference (plain id) via the seam", async () => {
    setAssetPickerOpener(vi.fn(async () => ({ assetId: "ast_gal1" })));
    const props = GalleryProps.parse(galleryDefaultProps());
    let next: GalleryProps | null = null;
    const el = render(
      h(GalleryEditor, {
        blockId: "blk_gal001",
        props,
        onChange: (value: GalleryProps) => {
          next = value;
        },
      }),
    );
    click(el.querySelector<HTMLButtonElement>('[data-testid="gallery-add-image"]')!);
    await waitFor(() => {
      expect(next).not.toBeNull();
    });
    expect(GalleryProps.parse(next as unknown).assetIds).toEqual(["ast_sample001", "ast_gal1"]);
  });

  it("gallery Add image… appends an alt record when the pick carries alt text", async () => {
    setAssetPickerOpener(vi.fn(async () => ({ assetId: "ast_gal2", alt: "Launch day" })));
    const props = GalleryProps.parse(galleryDefaultProps());
    let next: GalleryProps | null = null;
    const el = render(
      h(GalleryEditor, {
        blockId: "blk_gal001",
        props,
        onChange: (value: GalleryProps) => {
          next = value;
        },
      }),
    );
    click(el.querySelector<HTMLButtonElement>('[data-testid="gallery-add-image"]')!);
    await waitFor(() => {
      expect(next).not.toBeNull();
    });
    expect(GalleryProps.parse(next as unknown).assetIds[1]).toEqual({ assetId: "ast_gal2", alt: "Launch day" });
  });
});
