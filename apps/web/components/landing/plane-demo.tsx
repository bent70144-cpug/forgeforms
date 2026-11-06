"use client";

// The signature demo: one FormForge block document, rendered through the
// three publish planes. Everything is stylised HTML/CSS (no screenshots, no
// canvas). A tablist switches between planes; the tabs auto-advance every
// six seconds and stop for hover, keyboard focus, scrolling off screen and
// prefers-reduced-motion, with a visible pause control. Without JavaScript
// the first panel renders statically and the others stay hidden.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

type PlaneId = "scroll" | "converse" | "embed";

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function IconPage() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...STROKE}>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
      <path d="M8.5 8h7M8.5 11.5h7M8.5 15h4" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...STROKE}>
      <path d="M21 14.5a2 2 0 0 1-2 2H8l-4.5 4V5.5a2 2 0 0 1 2-2H19a2 2 0 0 1 2 2Z" />
      <path d="M8.5 9.5h7M8.5 12.5h4" />
    </svg>
  );
}

function IconEmbed() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...STROKE}>
      <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...STROKE}>
      <path d="M9 6v12M15 6v12" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...STROKE}>
      <path d="M8.5 5.5v13l10-6.5Z" />
    </svg>
  );
}

function Bar({ w }: { w: string }) {
  return <span aria-hidden="true" className={`ff-mock-bar ${w}`} />;
}

function ScrollPlane() {
  return (
    <div
      role="img"
      aria-label="Illustration: the sample document rendered as a server-rendered scroll page"
      className="ff-mock"
    >
      <div className="ff-mock-page">
        <div className="flex items-center justify-between gap-4">
          <span className="ff-mock-wordmark">Say hello</span>
          <span className="flex items-center gap-1.5">
            <Bar w="w-7" />
            <Bar w="w-7" />
            <Bar w="w-7" />
          </span>
        </div>
        <div className="mt-5 grid gap-1.5">
          <span className="ff-mock-title">Say hello</span>
          <span className="ff-mock-caption">We read every message.</span>
        </div>
        <span className="ff-mock-btn mt-4">Get in touch</span>
        <p className="ff-mock-caption mt-4 border-t border-[var(--ff-border)] pt-3">
          Prefer email? Write to hello@example.com and we reply within a day.
        </p>
      </div>
    </div>
  );
}

function ConversePlane() {
  return (
    <div
      role="img"
      aria-label="Illustration: the same document played as a conversational form, one question at a time"
      className="ff-mock"
    >
      <div className="ff-mock-chat">
        <div className="grid gap-2">
          <span className="ff-mock-caption">
            Question <span className="ff-nums">2 of 4</span>
          </span>
          <span className="ff-progress" aria-hidden="true">
            <span className="ff-progress-fill" style={{ width: "50%" }} />
          </span>
        </div>
        <p className="ff-bubble">What is your email?</p>
        <span className="ff-bubble-input">
          <span>you@example.com</span>
          <span className="ff-bubble-send">Answer</span>
        </span>
        <p className="ff-mock-caption">
          One question at a time; conditional logic can skip the next.
        </p>
      </div>
    </div>
  );
}

function EmbedPlane() {
  return (
    <div
      role="img"
      aria-label="Illustration: the same document embedded as a sandboxed widget inside another site"
      className="ff-mock"
    >
      <div className="ff-mock-host">
        <span className="ff-mock-caption">Your own site</span>
        <span className="grid gap-2">
          <Bar w="w-32" />
          <Bar w="w-24" />
        </span>
        <div className="ff-widget">
          <span className="ff-mock-title">Say hello</span>
          <span className="ff-mock-caption">What is your email?</span>
          <span className="ff-widget-row">
            <span className="ff-widget-input">you@example.com</span>
            <span className="ff-bubble-send">Next</span>
          </span>
        </div>
      </div>
    </div>
  );
}

type Plane = {
  id: PlaneId;
  label: string;
  blurb: string;
  icon: ReactNode;
  body: ReactNode;
};

const PLANES: ReadonlyArray<Plane> = [
  {
    id: "scroll",
    label: "Scroll page",
    blurb: "Server-rendered HTML: fast first paint, friendly to search.",
    icon: <IconPage />,
    body: <ScrollPlane />,
  },
  {
    id: "converse",
    label: "Conversation",
    blurb: "The same blocks, asked one question at a time on the client.",
    icon: <IconChat />,
    body: <ConversePlane />,
  },
  {
    id: "embed",
    label: "Embed",
    blurb: "A sandboxed iframe widget with a publish-safe protocol.",
    icon: <IconEmbed />,
    body: <EmbedPlane />,
  },
];

const ROTATE_MS = 6000;

export default function PlaneDemo() {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Auto-advance only while the demo is actually on screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setOnScreen(entry.isIntersecting);
      },
      { threshold: 0.25 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!auto || hovered || focusWithin || !onScreen) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setActive((current) => (current + 1) % PLANES.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [auto, hovered, focusWithin, onScreen]);

  const select = (index: number) => {
    setActive(index);
    setAuto(false); // a manual choice ends the rotation
  };

  // The plane shown now; `.at` keeps noUncheckedIndexedAccess honest.
  const current = PLANES.at(active);

  const onTablistKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = PLANES.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = active === last ? 0 : active + 1;
    else if (event.key === "ArrowLeft") next = active === 0 ? last : active - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      ref={rootRef}
      className="ff-demo"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusWithin(false);
        }
      }}
    >
      <div className="ff-demo-head">
        <div
          role="tablist"
          aria-label="Render planes"
          className="ff-tabs"
          onKeyDown={onTablistKeyDown}
        >
          {PLANES.map((plane, index) => (
            <button
              key={plane.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`ff-tab-${plane.id}`}
              aria-selected={active === index}
              aria-controls={`ff-panel-${plane.id}`}
              tabIndex={active === index ? 0 : -1}
              onClick={() => select(index)}
              className={`ff-tab focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-primary)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55`}
            >
              {plane.icon}
              {plane.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`ff-demo-pause focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-primary)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55`}
          aria-pressed={!auto}
          onClick={() => setAuto((value) => !value)}
        >
          {auto ? <IconPause /> : <IconPlay />}
          {auto ? "Pause" : "Resume"}
        </button>
      </div>

      <div className="ff-stage">
        {PLANES.map((plane, index) => (
          <div
            key={plane.id}
            role="tabpanel"
            id={`ff-panel-${plane.id}`}
            aria-labelledby={`ff-tab-${plane.id}`}
            aria-hidden={active !== index}
            data-js-plane={plane.id}
            data-active={active === index ? "" : undefined}
            className="ff-plane"
          >
            {plane.body}
          </div>
        ))}
      </div>

      <p className="ff-demo-blurb">{current?.blurb}</p>
    </div>
  );
}
