'use client';

// Endings panel (builder spec §8.3 + §24 custom_redirect note).
//
// Left list of state.body.endings (click selects; local index state, clamped
// on removals) + editor for the selected ending + a live preview card styled
// from state.body.theme.tokens (§8.3 "each ending card shows a live preview";
// the panel root has no --ff-* vars, so styles are computed inline).
//
// Schema reality (packages/schema/src/document.ts): Ending = { id, title,
// body?, redirectUrl? }. §8.3's image / button label+URL / Share+Restart
// toggles do NOT exist yet → rendered as disabled controls with the note
// "Not available in this version" (render only what the schema carries).
//
// §24 (follow-up #8): the custom_redirect entitlement IS wired now — the
// builder store carries the envelope's `entitlements`. When customRedirect is
// false the redirect input is DISABLED with the inline note (in-place note,
// never an upgrade modal). When the entitlement is unknown (mocks/old
// envelopes) the legacy behavior stands: input ENABLED with the note. When
// entitled, the note is dropped and the field is fully editable.
//
// Mutual exclusion (§8.3): a redirect ending shows no body — setting a valid
// redirect URL disables the body textarea with its own inline note.
//
// Delete (§8.3/§6.4): the last ending cannot be deleted; deleting an ending
// referenced by logic rules (`goto` → `end:<endingId>`, packages/schema/
// src/rule.ts) prompts with a replacement picker that rewrites those rules
// in the SAME apply batch as the removal (single undo step).

import { useCallback, useEffect, useState } from "react";
import type { Ending, Rule } from "../../lib/bridge";
import { DEFAULT_THEME_TOKENS, type ThemeTokenKey } from "../../lib/bridge";
import { newId } from "../../lib/builder/id";
import type { Op } from "../../lib/builder/ops";
import { useBuilder } from "./context";

/** Debounce for ending title/body/redirect text edits. */
export const ENDING_EDIT_DEBOUNCE_MS = 300;

/** §8.3 fields that the current Ending schema does not carry. */
export const NOT_AVAILABLE_NOTE = "Not available in this version";

/** §24 inline note — shown when the redirect field is gated on the plan
 * (customRedirect false) or the entitlement is unknown. */
export const REDIRECT_PRO_NOTE = "Redirect endings require Pro";

/** Inline note shown when a redirect is set (§8.3 mutual exclusion with body). */
export const REDIRECT_NO_BODY_NOTE = "Redirect endings show no body";

/** Last-ending guard (§8.3 "cannot delete the last ending"). */
export const LAST_ENDING_NOTE = "A form needs at least one ending";

/** Valid default ending per the schema ({ id, title } required; rest optional). */
export function newEnding(makeId: () => string = newId): Ending {
  return { id: makeId(), title: "Thank you!" };
}

/**
 * Rules that jump to `end:<endingId>` (the only ending reference in the rule
 * schema — canvas-ops' hasLogicReference covers @block:/scope refs only).
 */
export function rulesReferencingEnding(rules: readonly Rule[], endingId: string): Rule[] {
  const target = `end:${endingId}`;
  return rules.filter((rule) => rule.then.some((action) => action.type === "goto" && action.target === target));
}

/** https:// URL validation for the redirect field (empty = clearing, fine). */
export function redirectError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? null : "Must be an https:// URL";
  } catch {
    return "Must be an https:// URL";
  }
}

/** Preview chip text on the list rows. */
export function endingChip(ending: Ending): string {
  if (ending.redirectUrl) return "Redirect";
  if (ending.body) return "Body";
  return "Blank";
}

export function EndingsPanel() {
  const { state, dispatch } = useBuilder();
  const endings = state.body.endings;
  const rules = state.body.logic.rules;
  // §24 customRedirect entitlement (undefined = unknown → legacy behavior).
  const customRedirect = state.entitlements?.customRedirect;
  const redirectGated = customRedirect === false;

  // Selection is a LOCAL index, clamped against removals/undo.
  const [selectedIdxRaw, setSelectedIdx] = useState(0);
  const selectedIdx = Math.min(selectedIdxRaw, Math.max(0, endings.length - 1));
  useEffect(() => {
    if (selectedIdx !== selectedIdxRaw) setSelectedIdx(selectedIdx);
  }, [selectedIdx, selectedIdxRaw]);

  const selected: Ending | undefined = endings[selectedIdx];

  // Text drafts (one per field; the editor shows a single ending at a time).
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [bodyDraft, setBodyDraft] = useState<string | null>(null);
  const [redirectDraft, setRedirectDraft] = useState<string | null>(null);

  const clearDrafts = useCallback(() => {
    setTitleDraft(null);
    setBodyDraft(null);
    setRedirectDraft(null);
  }, []);

  // Drop drafts that the store caught up with, and any drafts belonging to a
  // different ending than the one now selected.
  useEffect(() => {
    if (!selected) return;
    setTitleDraft((prev) => (prev !== null && prev !== selected.title ? prev : null));
    setBodyDraft((prev) => (prev !== null && prev !== (selected.body ?? "") ? prev : null));
    setRedirectDraft((prev) => (prev !== null && prev !== (selected.redirectUrl ?? "") ? prev : null));
  }, [selected]);

  const upsert = useCallback(
    (ending: Ending, label: string, coalesceKey?: string) => {
      dispatch({
        type: "apply",
        ops: [{ op: "ending.upsert", ending }],
        label,
        ...(coalesceKey ? { coalesce: { key: coalesceKey, at: Date.now() } } : {}),
      });
    },
    [dispatch],
  );

  // Debounced text-edit commit (title/body/redirect drafts together — they
  // change one at a time but share the 300 ms window).
  useEffect(() => {
    if (!selected) return;
    const pendingTitle = titleDraft !== null && titleDraft !== selected.title;
    const pendingBody = bodyDraft !== null && bodyDraft !== (selected.body ?? "");
    const pendingRedirect = redirectDraft !== null && redirectDraft !== (selected.redirectUrl ?? "");
    if (!pendingTitle && !pendingBody && !pendingRedirect) return;
    const timer = setTimeout(() => {
      let current: Ending = selected;
      if (pendingTitle) {
        // An emptied title keeps the previous one (title is schema-required).
        const title = titleDraft.trim() === "" ? selected.title : titleDraft;
        current = { ...current, title };
        upsert(current, "Edit ending title", `ending:${selected.id}:title`);
      }
      if (pendingBody) {
        if (bodyDraft === "") {
          const { body: _drop, ...rest } = current;
          current = rest as Ending;
        } else {
          current = { ...current, body: bodyDraft };
        }
        upsert(current, "Edit ending body", `ending:${selected.id}:body`);
      }
      if (pendingRedirect && !redirectGated && redirectError(redirectDraft) === null) {
        if (redirectDraft.trim() === "") {
          const { redirectUrl: _drop, ...rest } = current;
          current = rest as Ending;
        } else {
          current = { ...current, redirectUrl: redirectDraft.trim() };
        }
        upsert(current, "Set ending redirect", `ending:${selected.id}:redirect`);
      }
      clearDrafts();
    }, ENDING_EDIT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [selected, titleDraft, bodyDraft, redirectDraft, upsert, clearDrafts]);

  const addEnding = () => {
    dispatch({
      type: "apply",
      ops: [{ op: "ending.upsert", ending: newEnding() }],
      label: "Add ending",
    });
    // The new ending lands at the end of the list (ops.ts append semantics).
    setSelectedIdx(endings.length);
    clearDrafts();
  };

  // --- delete flow -----------------------------------------------------------
  const referencing = selected ? rulesReferencingEnding(rules, selected.id) : [];
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [replacementId, setReplacementId] = useState<string>("");
  // Reset the confirm strip whenever the selection (or reference set) changes.
  useEffect(() => {
    setConfirmDelete(false);
    setReplacementId("");
  }, [selected?.id, referencing.length]);

  const canDelete = endings.length > 1;

  const deleteSelected = (replacement: string | null) => {
    if (!selected || !canDelete) return;
    const ops: Op[] = [];
    if (replacement !== null && referencing.length > 0) {
      for (const rule of referencing) {
        ops.push({
          op: "rule.upsert" as const,
          rule: {
            ...rule,
            then: rule.then.map((action) =>
              action.type === "goto" && action.target === `end:${selected.id}`
                ? { ...action, target: `end:${replacement}` }
                : action,
            ),
          },
        });
      }
    }
    ops.push({ op: "ending.remove" as const, id: selected.id });
    dispatch({ type: "apply", ops, label: "Delete ending" });
    setSelectedIdx(Math.max(0, selectedIdx - 1));
    setConfirmDelete(false);
    clearDrafts();
  };

  if (endings.length === 0 || !selected) {
    return (
      <div className="ff-th-panel" data-testid="endings-panel">
        <section aria-label="Endings" className="ff-th-section">
          <h3 className="ff-th-section-title">Endings</h3>
          <p className="ff-th-note" data-testid="endings-empty">
            No endings yet — add one to close the form.
          </p>
          <button type="button" className="ff-th-btn" onClick={addEnding}>
            Add ending
          </button>
        </section>
      </div>
    );
  }

  const tokens = (key: ThemeTokenKey): string => state.body.theme.tokens[key] ?? DEFAULT_THEME_TOKENS[key];
  const bodyLocked = Boolean(selected.redirectUrl);
  const redirectValue = redirectDraft ?? selected.redirectUrl ?? "";
  const redirectIssue = redirectError(redirectValue);
  const otherEndings = endings.filter((e) => e.id !== selected.id);
  // The strip's select DISPLAYS the first other ending by default; resolving
  // the effective replacement here keeps that default actually usable.
  const effectiveReplacement = replacementId || otherEndings[0]?.id || "";

  return (
    <div className="ff-th-panel" data-testid="endings-panel">
      {/* --- Endings list (§8.3 left-pane rows + preview chip) ---------------- */}
      <section aria-label="Endings" className="ff-th-section">
        <h3 className="ff-th-section-title">Endings</h3>
        <ul className="ff-th-endings-list" data-testid="endings-list">
          {endings.map((ending, idx) => (
            <li key={ending.id}>
              <button
                type="button"
                className={
                  idx === selectedIdx ? "ff-th-ending-row ff-th-ending-row--active" : "ff-th-ending-row"
                }
                aria-current={idx === selectedIdx ? "true" : undefined}
                data-ending-id={ending.id}
                onClick={() => {
                  setSelectedIdx(idx);
                  clearDrafts();
                }}
              >
                <span aria-hidden="true">🏁</span>
                <span className="ff-th-ending-title" dir="auto">{ending.title}</span>
                <span className="ff-th-chip" aria-hidden="true">
                  {endingChip(ending)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="ff-th-btn" data-testid="ending-add" onClick={addEnding}>
          Add ending
        </button>
      </section>

      {/* --- Editor for the selected ending ------------------------------------ */}
      <section aria-label="Ending editor" className="ff-th-section">
        <h3 className="ff-th-section-title">Ending editor</h3>

        <div className="ff-th-field">
          <label className="ff-th-row-label" htmlFor="ff-ending-title">
            Title
          </label>
          <input
            id="ff-ending-title"
            type="text"
            className="ff-th-input"
            value={titleDraft ?? selected.title}
            onChange={(e) => setTitleDraft(e.target.value)}
          />
        </div>

        <div className="ff-th-field">
          <label className="ff-th-row-label" htmlFor="ff-ending-body">
            Body
          </label>
          <textarea
            id="ff-ending-body"
            className="ff-th-input"
            rows={3}
            value={bodyDraft ?? selected.body ?? ""}
            disabled={bodyLocked}
            onChange={(e) => setBodyDraft(e.target.value)}
          />
          {bodyLocked && (
            <span className="ff-th-note" role="note">
              {REDIRECT_NO_BODY_NOTE}
            </span>
          )}
        </div>

        {/* Schema has no image field yet (§8.3) — disabled control + note. */}
        <div className="ff-th-field">
          <label className="ff-th-row-label" htmlFor="ff-ending-image">
            Image
          </label>
          <input
            id="ff-ending-image"
            type="text"
            className="ff-th-input"
            placeholder="https://…"
            disabled
            aria-disabled="true"
          />
          <span className="ff-th-note">{NOT_AVAILABLE_NOTE}</span>
        </div>

        {/* Schema has no button field yet (§8.3) — disabled controls + note. */}
        <div className="ff-th-field">
          <span className="ff-th-row-label">Button</span>
          <div className="ff-th-row">
            <input
              type="text"
              className="ff-th-input"
              aria-label="Button label"
              placeholder="Label"
              disabled
              aria-disabled="true"
            />
            <input
              type="text"
              className="ff-th-input"
              aria-label="Button URL"
              placeholder="https://…"
              disabled
              aria-disabled="true"
            />
          </div>
          <span className="ff-th-note">{NOT_AVAILABLE_NOTE}</span>
        </div>

        {/* redirectUrl IS in the schema and the custom_redirect entitlement
            is wired (§24): gated on free (disabled + note), free-to-edit on
            pro/business, and the legacy note stands when unknown. */}
        <div className="ff-th-field">
          <label className="ff-th-row-label" htmlFor="ff-ending-redirect">
            Redirect URL
          </label>
          <input
            id="ff-ending-redirect"
            type="text"
            className="ff-th-input"
            placeholder="https://…"
            value={redirectValue}
            spellCheck={false}
            disabled={redirectGated}
            aria-disabled={redirectGated}
            onChange={(e) => setRedirectDraft(e.target.value)}
          />
          {(redirectGated || customRedirect === undefined) && (
            <span className="ff-th-note" role="note">
              {REDIRECT_PRO_NOTE}
            </span>
          )}
          {redirectIssue !== null && (
            <span className="ff-th-error" role="alert">
              {redirectIssue}
            </span>
          )}
        </div>

        {/* Schema has no share/restart toggles yet (§8.3). */}
        <fieldset className="ff-th-field" disabled>
          <legend className="ff-th-row-label">After submission</legend>
          <label className="ff-th-row">
            <input type="checkbox" disabled aria-disabled="true" /> Show Share button
          </label>
          <label className="ff-th-row">
            <input type="checkbox" disabled aria-disabled="true" /> Show Restart button
          </label>
          <span className="ff-th-note">{NOT_AVAILABLE_NOTE}</span>
        </fieldset>

        {/* --- Delete (last-ending guard + logic-reference confirm) ------------ */}
        <div className="ff-th-field" data-testid="ending-delete-zone">
          <button
            type="button"
            className="ff-th-btn ff-th-btn--danger"
            data-testid="ending-delete"
            disabled={!canDelete}
            aria-disabled={!canDelete}
            onClick={() => {
              if (referencing.length > 0) setConfirmDelete(true);
              else deleteSelected(null);
            }}
          >
            Delete ending
          </button>
          {!canDelete && <span className="ff-th-note">{LAST_ENDING_NOTE}</span>}

          {confirmDelete && referencing.length > 0 && (
            <div className="ff-th-confirm" role="group" aria-label="Confirm ending deletion">
              <span>
                Used by {referencing.length} {referencing.length === 1 ? "rule" : "rules"} — pick replacement:
              </span>
              <select
                className="ff-th-select"
                aria-label="Replacement ending"
                value={effectiveReplacement}
                onChange={(e) => setReplacementId(e.target.value)}
              >
                {otherEndings.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ff-th-btn ff-th-btn--danger"
                data-testid="ending-delete-confirm"
                disabled={effectiveReplacement === ""}
                onClick={() => deleteSelected(effectiveReplacement)}
              >
                Delete ending
              </button>
              <button type="button" className="ff-th-btn" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </section>

      {/* --- Live preview card (§8.3; styles computed from theme tokens) ------- */}
      <section aria-label="Ending preview" className="ff-th-section">
        <h3 className="ff-th-section-title">Preview</h3>
        <div
          className="ff-th-preview"
          data-testid="ending-preview"
          style={{
            background: tokens("color.bg"),
            color: tokens("color.fg"),
            border: `1px solid ${tokens("color.border")}`,
            borderRadius: PREVIEW_RADIUS[state.body.theme.radius],
            fontFamily: `"${state.body.theme.fontBody}", system-ui, sans-serif`,
          }}
        >
          <h4
            dir="auto"
            style={{
              color: tokens("color.fg"),
              fontFamily: `"${state.body.theme.fontHeading}", system-ui, sans-serif`,
            }}
          >
            {selected.title}
          </h4>
          {selected.redirectUrl ? (
            <p dir="auto" style={{ color: tokens("color.muted") }}>Redirects to {selected.redirectUrl}</p>
          ) : (
            <p dir="auto" style={{ color: tokens("color.muted") }}>{selected.body || "No body text."}</p>
          )}
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              padding: "0.5rem 1rem",
              background: tokens("color.primary"),
              color: tokens("color.primaryFg"),
              borderRadius: PREVIEW_RADIUS[state.body.theme.radius],
            }}
          >
            Continue
          </span>
        </div>
      </section>
    </div>
  );
}

const PREVIEW_RADIUS: Record<string, number> = { none: 0, sm: 6, md: 10, lg: 16, full: 999 };
