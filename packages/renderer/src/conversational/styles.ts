// One small stylesheet injected once per renderer root. Inline styles cover
// per-element layout; this covers resets, focus rings, motion and the
// 390×844-class viewport tweaks (spec §15 M3 "Mobile verification").
export const CONVERSATIONAL_STYLES = `
.ff-root, .ff-root * { box-sizing: border-box; }
.ff-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: var(--ff-bg);
  color: var(--ff-fg);
  font-family: var(--ff-font-body);
  font-size: 16px;
  line-height: 1.5;
  position: relative;
  -webkit-font-smoothing: antialiased;
}
.ff-root button { font: inherit; color: inherit; }
.ff-root button, .ff-root input, .ff-root textarea { font-family: var(--ff-font-body); }
.ff-root :is(button, input, textarea, a):focus-visible {
  outline: 2px solid var(--ff-primary);
  outline-offset: 2px;
  border-radius: var(--ff-radius);
}
.ff-screen {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding: 24px 20px 96px;
  animation: ff-enter 240ms ease-out both;
}
.ff-screen:focus { outline: none; }
.ff-question-label {
  font-family: var(--ff-font-heading);
  font-size: 24px;
  font-weight: 650;
  margin: 0 0 8px;
  overflow-wrap: anywhere;
}
.ff-question-desc { color: var(--ff-muted); margin: 0 0 20px; font-size: 15px; }
.ff-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  position: relative;
}
.ff-hint { color: var(--ff-muted); font-size: 12.5px; margin-top: 14px; }
.ff-hint kbd {
  border: 1px solid var(--ff-border);
  border-bottom-width: 2px;
  border-radius: 4px;
  padding: 0 5px;
  font-size: 11px;
  font-family: inherit;
}
.ff-error { color: #b91c1c; font-size: 14px; margin: 10px 0 0; }
.ff-input {
  width: 100%;
  border: 1px solid var(--ff-border);
  border-radius: var(--ff-radius);
  background: var(--ff-bg);
  color: var(--ff-fg);
  padding: 12px 14px;
  font-size: 16px; /* ≥16px prevents iOS focus zoom */
}
.ff-input[aria-invalid='true'] { border-color: #b91c1c; }
.ff-input::placeholder { color: var(--ff-muted); opacity: 0.7; }
.ff-continue {
  margin-top: 18px;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  border-radius: var(--ff-radius);
  background: var(--ff-primary);
  color: var(--ff-primary-fg);
  padding: 10px 18px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.ff-option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  border: 1px solid var(--ff-border);
  border-radius: var(--ff-radius);
  background: var(--ff-bg);
  padding: 12px 14px;
  margin-bottom: 8px;
  cursor: pointer;
  font-size: 16px;
}
.ff-option[aria-checked='true'], .ff-option[aria-selected='true'] {
  border-color: var(--ff-primary);
  box-shadow: inset 0 0 0 1px var(--ff-primary);
}
.ff-option-key {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--ff-border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--ff-muted);
}
.ff-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ff-muted);
  font-size: 12px;
  text-decoration: none;
}
.ff-badge:hover { color: var(--ff-fg); }
.ff-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
@keyframes ff-enter {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .ff-screen { animation: none; }
}
@media (max-width: 480px) {
  .ff-screen { padding: 20px 16px 88px; }
  .ff-question-label { font-size: 21px; }
}
`;
