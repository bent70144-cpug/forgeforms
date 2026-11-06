"use client";

// Accessible modal dialog (design-system primitive, F3).
//
// Behavior contract (same as Drawer):
//   · portal to document.body, hydration-safe (portal renders only after mount;
//     the server HTML contains nothing, so no pre-mount hiding exists and no
//     data-js-* hidden-state attribute is needed — the modal starts closed)
//   · Esc closes; backdrop click closes; body scroll locked while open
//   · focus is trapped inside the panel (Tab cycles), moved to the panel on
//     open and restored to the previously focused element on close
//   · entrance animation is transform/opacity only (ff-modal-in in globals.css,
//     collapsed automatically under prefers-reduced-motion)
//   · ARIA: role="dialog" aria-modal="true" aria-labelledby/describedby
//
// Styling classes live in app/globals.css (OVERLAYS section): .ff-overlay,
// .ff-modal-panel, .ff-modal-header/title/description/body/footer.

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icons";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // Keep the latest callback without re-running the open/close effect when a
  // parent passes an inline onClose.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !mounted) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open, mounted]);

  if (!open || !mounted) return null;

  return createPortal(
    <>
      <div
        className="ff-overlay"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={wide ? "ff-modal-panel ff-modal-panel--wide" : "ff-modal-panel"}
      >
        <header className="ff-modal-header">
          <div>
            <h2 id={titleId} className="ff-modal-title">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="ff-modal-description">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="ff-icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x" size={18} />
          </button>
        </header>
        {children ? <div className="ff-modal-body">{children}</div> : null}
        {footer ? <footer className="ff-modal-footer">{footer}</footer> : null}
      </div>
    </>,
    document.body,
  );
}
