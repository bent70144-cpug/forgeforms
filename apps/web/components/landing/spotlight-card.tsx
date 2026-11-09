"use client";

// Pointer-tracked spotlight for the feature grid. The highlight is a soft
// wash that follows the mouse via two CSS custom properties (--sx/--sy). The
// base recipe (a quiet foreground wash) lives in app/globals.css; the landing
// page overrides it in app/landing.css with a violet→aurora tint. Updates are
// batched in requestAnimationFrame and the whole effect is skipped for touch
// pointers and for visitors with prefers-reduced-motion, so the cards stay
// plain there. No-JS and touch users simply see bordered cards; nothing
// depends on this running.

import { useRef, type ReactNode } from "react";

type SpotlightCardProps = {
  children: ReactNode;
  className?: string;
};

export default function SpotlightCard({ children, className }: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  const track = (clientX: number, clientY: number) => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--sx", `${Math.round(clientX - rect.left)}px`);
      el.style.setProperty("--sy", `${Math.round(clientY - rect.top)}px`);
    });
  };

  return (
    <div
      ref={ref}
      className={className ? `ff-spot ${className}` : "ff-spot"}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        track(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse") return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        track(event.clientX, event.clientY);
      }}
      onPointerLeave={() => {
        if (frame.current) {
          cancelAnimationFrame(frame.current);
          frame.current = 0;
        }
      }}
    >
      {children}
    </div>
  );
}
