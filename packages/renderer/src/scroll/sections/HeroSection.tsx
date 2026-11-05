import type { HeroViewProps } from "../blocks";

/** Content block: hero (spec §7.2). Server component — zero client JS. */
export function HeroSection({ props }: { props: HeroViewProps }) {
  const hasTitle = props.title !== "";
  const hasSubtitle = props.subtitle !== "";
  if (!hasTitle && !hasSubtitle && props.imageUrl === null && props.cta === null) {
    return null;
  }
  return (
    <section className="ff-section-hero px-6 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-3xl text-center">
        {props.imageUrl !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- renderer stays framework-portable; snapshot URLs are CDN-resolved
          <img
            src={props.imageUrl}
            alt=""
            decoding="async"
            className="mx-auto mb-10 h-auto w-full max-w-2xl rounded-[var(--ff-radius)] object-cover"
          />
        ) : null}
        {hasTitle ? (
          <h1
            className="text-balance text-4xl font-bold tracking-tight sm:text-5xl"
            style={{ fontFamily: "var(--ff-font-heading, inherit)", color: "var(--ff-fg, inherit)" }}
          >
            {props.title}
          </h1>
        ) : null}
        {hasSubtitle ? (
          <p
            className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-[var(--ff-muted)]"
            style={{ fontFamily: "var(--ff-font-body, inherit)" }}
          >
            {props.subtitle}
          </p>
        ) : null}
        {props.cta !== null ? (
          <a
            href={props.cta.href}
            className="mt-10 inline-block rounded-[var(--ff-radius)] px-7 py-3 text-base font-semibold no-underline"
            style={{ backgroundColor: "var(--ff-primary)", color: "var(--ff-primary-fg)" }}
          >
            {props.cta.label}
          </a>
        ) : null}
      </div>
    </section>
  );
}
