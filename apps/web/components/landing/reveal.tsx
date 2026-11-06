"use client";

// Scroll reveal as progressive enhancement (Hallmark gate 62 / task rule 3):
// the server HTML renders fully visible. Only after mount, and only when
// IntersectionObserver exists and the visitor allows motion, does this
// component arm the hidden state (data-js-reveal="armed") and then swap it
// for the "in" state on first intersection. The CSS for both states lives in
// app/globals.css under the landing section; the attribute name carries the
// "data-js-" prefix on purpose so the hidden state is always script-scoped.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Stagger step: each step delays the entrance by 60ms (max 4). */
  step?: number;
};

export default function Reveal({ children, className, step = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<"idle" | "armed" | "in">("idle");

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    setPhase("armed");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setPhase("in");
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const style = step > 0 ? ({ "--i": step } as CSSProperties) : undefined;

  return (
    <div
      ref={ref}
      className={className ? `ff-reveal ${className}` : "ff-reveal"}
      data-js-reveal={phase === "idle" ? undefined : phase}
      style={style}
    >
      {children}
    </div>
  );
}
