// The 23 block-kind palette as a slow, pausable CSS marquee. One track is
// real content; the second is an aria-hidden duplicate so the loop is
// seamless. The animation is pure CSS (app/globals.css): it pauses on hover
// and focus-within, and under prefers-reduced-motion the tracks stop, wrap
// into a static row, and the duplicate is removed from the layout.

const BLOCK_KINDS = [
  "Hero",
  "Text",
  "Image",
  "Gallery",
  "Video",
  "Testimonials",
  "FAQ",
  "Pricing",
  "Projects",
  "Contact links",
  "Section",
  "Columns",
  "Multi-question page",
  "Button",
  "Form embed",
  "Short text",
  "Long text",
  "Email",
  "Number",
  "Single select",
  "Multi select",
  "Dropdown",
  "Rating",
] as const;

function Track({ hidden }: { hidden?: boolean }) {
  return (
    <div className="ff-marquee-track" aria-hidden={hidden || undefined}>
      {BLOCK_KINDS.map((kind) => (
        <span key={kind} className="ff-chip">
          {kind}
        </span>
      ))}
    </div>
  );
}

export default function BlockMarquee() {
  return (
    <div className="ff-marquee">
      <Track />
      <Track hidden />
    </div>
  );
}
