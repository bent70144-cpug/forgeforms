'use client';

// Document settings (builder spec §6.6 "Document selected"): five tabs —
// General / Behavior / Limits / Notifications / SEO — applied as ops through
// the builder store. Autosave rules (§6.6, §13):
//   • toggles + selects dispatch IMMEDIATELY;
//   • text inputs dispatch debounced 300 ms (useDebouncedPatch);
//   • validation errors are per-field local state — they style the field and
//     show a message but NEVER block the (draft) autosave.
//
// §24 plan gates: the builder client has no entitlements surface (the GET
// envelope carries no permissions — verified against lib/bridge.ts +
// app/api/v1/documents/[id]/route.ts), so `showBranding` renders as a STATIC
// gate: switch locked on + disabled + the §24 inline note "Available on Pro".
// No upgrade modals anywhere (§24 forbids them inside the builder).

import { useState } from "react";
import { useBuilder } from "../context";
import {
  FF_SET_INPUT_CLASS,
  FieldRow,
  InlineNote,
  SettingsSection,
} from "./FieldRow";
import { ToggleRow } from "./ToggleRow";
import { EmailListEditor } from "./ListEditor";
import {
  MAX_NOTIFY_EMAILS,
  datetimeLocalToUtcIso,
  isValidSlug,
  utcIsoToDatetimeLocal,
  useDebouncedPatch,
  useDraftSync,
} from "./settings-helpers";

export type DocSettingsTab = "general" | "behavior" | "limits" | "notifications" | "seo";

const TABS: ReadonlyArray<{ id: DocSettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "behavior", label: "Behavior" },
  { id: "limits", label: "Limits" },
  { id: "notifications", label: "Notifications" },
  { id: "seo", label: "SEO" },
];

const LOCALES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "en", label: "English" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
];

const SLUG_HINT = "3–60 characters: lowercase letters, digits and hyphens.";

export function DocSettings({ initialTab }: { initialTab?: DocSettingsTab } = {}) {
  const { state, dispatch } = useBuilder();
  const [tab, setTab] = useState<DocSettingsTab>(initialTab ?? "general");
  const settings = state.body.settings;

  // --- debounced text patches (op builders run at push time) ---------------
  const pushMetaTitle = useDebouncedPatch(
    (value) => [{ op: "meta.update", patch: { title: value } }],
    { label: "Rename document", coalesceKey: "meta:title" },
  );
  const pushSlug = useDebouncedPatch(
    // Empty input unsets the slug (meta.update `null` deletes, §21).
    (value) => [{ op: "meta.update", patch: { slug: value === "" ? null : value } }],
    { label: "Edit settings", coalesceKey: "meta:slug" },
  );
  const pushSeoTitle = useDebouncedPatch(
    // `null` deletes the seo key (settings.update per-key merge, §21).
    (value) => [{ op: "settings.update", patch: { seo: { title: value === "" ? null : value } } }],
    { label: "Edit settings", coalesceKey: "settings:seo.title" },
  );
  const pushSeoDescription = useDebouncedPatch(
    (value) => [
      { op: "settings.update", patch: { seo: { description: value === "" ? null : value } } },
    ],
    { label: "Edit settings", coalesceKey: "settings:seo.description" },
  );

  // --- immediate patches (toggles/selects, §6.6) ---------------------------
  const updateSettings = (patch: Record<string, unknown>): void =>
    dispatch({ type: "apply", ops: [{ op: "settings.update", patch }], label: "Update settings" });

  const metaTitle = state.meta.title;
  const metaSlug = state.meta.slug ?? "";
  const [titleDraft, setTitleDraft] = useDraftSync(metaTitle);
  const [slugDraft, setSlugDraft] = useDraftSync(metaSlug);
  const slugError = slugDraft !== "" && !isValidSlug(slugDraft)
    ? "Use 3–60 lowercase letters, digits or hyphens — e.g. customer-feedback."
    : null;

  const seoTitle = settings.seo.title ?? "";
  const seoDescription = settings.seo.description ?? "";
  const [seoTitleDraft, setSeoTitleDraft] = useDraftSync(seoTitle);
  const [seoDescriptionDraft, setSeoDescriptionDraft] = useDraftSync(seoDescription);

  return (
    <div className="ff-set-panel" data-testid="doc-settings">
      <div role="tablist" aria-label="Document settings" className="ff-set-tabs">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`ff-set-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`ff-set-panel-${entry.id}`}
            className="ff-set-tab"
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`ff-set-panel-${tab}`}
        aria-labelledby={`ff-set-tab-${tab}`}
        className="flex flex-col gap-4 p-3"
      >
        {tab === "general" && (
          <>
            <SettingsSection title="General">
              <FieldRow label="Title" htmlFor="ff-set-doc-title" error={null}>
                <input
                  id="ff-set-doc-title"
                  type="text"
                  value={titleDraft}
                  data-testid="ff-set-doc-title"
                  className={FF_SET_INPUT_CLASS}
                  onChange={(event) => {
                    setTitleDraft(event.target.value);
                    pushMetaTitle(event.target.value);
                  }}
                />
              </FieldRow>
              <FieldRow
                label="Slug"
                htmlFor="ff-set-doc-slug"
                hint={SLUG_HINT}
                error={slugError}
              >
                {/* TODO(wave 3): add the §6.6 availability probe —
                    GET /api/v1/documents/:id/slug-check (route missing yet);
                    on "taken" show an inline error + `-2` variant (§14). */}
                <input
                  id="ff-set-doc-slug"
                  type="text"
                  value={slugDraft}
                  placeholder="my-form"
                  data-testid="ff-set-doc-slug"
                  aria-invalid={slugError !== null}
                  className={FF_SET_INPUT_CLASS}
                  onChange={(event) => {
                    setSlugDraft(event.target.value);
                    pushSlug(event.target.value);
                  }}
                />
              </FieldRow>
              <FieldRow label="Language" htmlFor="ff-set-doc-locale">
                <select
                  id="ff-set-doc-locale"
                  value={settings.locale}
                  data-testid="ff-set-doc-locale"
                  className={FF_SET_INPUT_CLASS}
                  onChange={(event) => updateSettings({ locale: event.target.value })}
                >
                  {LOCALES.map((locale) => (
                    <option key={locale.value} value={locale.value}>
                      {locale.label}
                    </option>
                  ))}
                </select>
              </FieldRow>
            </SettingsSection>
          </>
        )}

        {tab === "behavior" && (
          <SettingsSection title="Behavior" testId="ff-set-behavior">
            <ToggleRow
              label="Progress bar"
              checked={settings.progressBar}
              onChange={(next) => updateSettings({ progressBar: next })}
              testId="ff-set-progress-bar"
            />
            <ToggleRow
              label="Auto-advance"
              checked={settings.autoAdvance}
              onChange={(next) => updateSettings({ autoAdvance: next })}
              testId="ff-set-auto-advance"
            />
            <div>
              <ToggleRow
                label="Show FormForge branding"
                checked={settings.showBranding}
                // §24 static gate: no entitlements surface client-side yet →
                // the switch is locked ON and disabled with an inline note.
                disabled
                onChange={() => undefined}
                testId="ff-set-branding"
              />
              <InlineNote testId="ff-set-branding-note">Available on Pro</InlineNote>
            </div>
            <ToggleRow
              label="Captcha"
              checked={settings.captcha}
              onChange={(next) => updateSettings({ captcha: next })}
              testId="ff-set-captcha"
            />
          </SettingsSection>
        )}

        {tab === "limits" && (
          <SettingsSection title="Limits" testId="ff-set-limits">
            <FieldRow
              label="Close at"
              htmlFor="ff-set-close-at"
              hint="Times use this device's timezone; stored as UTC (ISO)."
            >
              <input
                id="ff-set-close-at"
                type="datetime-local"
                value={utcIsoToDatetimeLocal(settings.closeAt)}
                data-testid="ff-set-close-at"
                className={FF_SET_INPUT_CLASS}
                onChange={(event) => {
                  const parsed = datetimeLocalToUtcIso(event.target.value);
                  if (!parsed.ok) return; // datetime-local emits valid strings; keep last value
                  updateSettings({ closeAt: parsed.iso });
                }}
              />
            </FieldRow>
            <FieldRow label="Max submissions" htmlFor="ff-set-max-submissions" hint="Leave empty for unlimited.">
              <input
                id="ff-set-max-submissions"
                type="number"
                min={1}
                step={1}
                value={settings.maxSubmissions ?? ""}
                data-testid="ff-set-max-submissions"
                className={FF_SET_INPUT_CLASS}
                onChange={(event) => {
                  const raw = event.target.value;
                  if (raw === "") {
                    updateSettings({ maxSubmissions: null }); // delete = unlimited
                    return;
                  }
                  const parsed = Number(raw);
                  if (!Number.isInteger(parsed) || parsed < 1) return; // partial typing; min=1 guards
                  updateSettings({ maxSubmissions: parsed });
                }}
              />
            </FieldRow>
          </SettingsSection>
        )}

        {tab === "notifications" && (
          <SettingsSection title="Notifications" testId="ff-set-notifications">
            <EmailListEditor
              emails={settings.notifyEmails}
              max={MAX_NOTIFY_EMAILS}
              onAdd={(email) =>
                updateSettings({ notifyEmails: [...settings.notifyEmails, email] })
              }
              onRemove={(email) =>
                updateSettings({
                  notifyEmails: settings.notifyEmails.filter(
                    (existing) => existing.toLowerCase() !== email.toLowerCase(),
                  ),
                })
              }
            />
            <InlineNote>
              Recipients get an email after every completed submission (§24: free plans are
              capped at 1 — plan checks arrive with billing integration).
            </InlineNote>
            <button type="button" disabled title="Coming soon" className="ff-set-btn" data-testid="ff-set-send-test-email">
              Send test email
            </button>
          </SettingsSection>
        )}

        {tab === "seo" && (
          <SettingsSection title="SEO & sharing" testId="ff-set-seo">
            <FieldRow label="SEO title" htmlFor="ff-set-seo-title">
              <input
                id="ff-set-seo-title"
                type="text"
                value={seoTitleDraft}
                data-testid="ff-set-seo-title"
                className={FF_SET_INPUT_CLASS}
                onChange={(event) => {
                  setSeoTitleDraft(event.target.value);
                  pushSeoTitle(event.target.value);
                }}
              />
            </FieldRow>
            <FieldRow label="SEO description" htmlFor="ff-set-seo-description">
              <textarea
                id="ff-set-seo-description"
                rows={3}
                value={seoDescriptionDraft}
                data-testid="ff-set-seo-description"
                className={FF_SET_INPUT_CLASS}
                onChange={(event) => {
                  setSeoDescriptionDraft(event.target.value);
                  pushSeoDescription(event.target.value);
                }}
              />
            </FieldRow>
            <FieldRow label="Social preview image" htmlFor="ff-set-og-image">
              {/* §10 asset picker is its own milestone — placeholder only. */}
              <button type="button" disabled className="ff-set-btn" data-testid="ff-set-og-picker">
                Image picker coming soon
              </button>
            </FieldRow>

            <SocialPreview
              title={seoTitleDraft === "" ? (metaTitle === "" ? "Untitled form" : metaTitle) : seoTitleDraft}
              description={seoDescriptionDraft === "" ? "Add a description so links preview nicely." : seoDescriptionDraft}
              image={settings.seo.ogImageAssetId}
            />
          </SettingsSection>
        )}
      </div>
    </div>
  );
}

/** Fake link-preview card (§6.6 "live social preview"). */
function SocialPreview({
  title,
  description,
  image,
}: {
  title: string;
  description: string;
  image?: string;
}) {
  return (
    <div className="ff-set-preview" data-testid="ff-set-social-preview" aria-label="Social link preview">
      <div className="ff-set-preview-image" aria-hidden="true">
        {image ? <span className="truncate px-2 text-xs">{image}</span> : <span>🖼</span>}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 p-2">
        <span className="truncate text-sm font-semibold">{title}</span>
        <span className="line-clamp-2 text-xs text-[color:var(--ff-muted)]">{description}</span>
        <span className="text-xs text-[color:var(--ff-muted)]">formforge.app</span>
      </div>
    </div>
  );
}
