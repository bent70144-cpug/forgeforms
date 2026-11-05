// Seed templates — PORTFOLIOS (spec §7.2 block catalog, §14.1.9).
// 4 portfolio templates with original marketing copy. Each pairs projects + gallery
// and carries a `form-embed` inquiry block, per the issue #22 acceptance walkthrough.
import type { TemplateDefinition } from "../types";
import { block, doc, FONTS, settings, theme } from "./helpers";

// SPEC-NOTE: `form-embed` blocks in seed templates ship with `documentId: ""`.
// The author binds one of their published forms after instantiation ("Use template"
// flow → pick form). Publish validation (spec §8, step 1) correctly refuses to
// publish until the target exists — that is the intended authoring checkpoint,
// not a template defect.
const INQUIRY_EMBED = { documentId: "" };

export const designerPortfolio: TemplateDefinition = {
  meta: {
    id: "designer-portfolio",
    name: "Product designer portfolio",
    description:
      "Case-study-first portfolio for product designers: selected work, a visual gallery, client voices and an embedded inquiry form.",
    category: "portfolio",
    tags: ["design", "career"],
    gradient: "from-fuchsia-500 via-purple-500 to-indigo-500",
    accent: "#a855f7",
  },
  body: doc(
    "portfolio",
    theme({ bg: "#faf5ff", fg: "#3b0764", primary: "#9333ea", primaryFg: "#ffffff", muted: "#7e22ce", border: "#e9d5ff", radius: "lg" }),
    [
      block("hero", "hero", {
        title: "Nadia Rahman — product designer",
        subtitle:
          "I design interfaces that respect attention. Eight years across fintech and developer tools; currently crafting flows at Ledgerline.",
        cta: { label: "Start a project", href: "#inquiry" },
      }),
      block("work", "projects", {
        items: [
          {
            title: "Ledgerline onboarding",
            description: "Cut time-to-first-invoice from 11 minutes to 3 by rebuilding activation around a single guided flow.",
            coverAssetId: "",
            link: "https://ledgerline.example/case/onboarding",
            tags: ["fintech", "activation"],
          },
          {
            title: "Atlas design system",
            description: "A 120-component system with tokens that survive both marketing and product surfaces.",
            coverAssetId: "",
            link: "https://ledgerline.example/case/atlas",
            tags: ["design systems"],
          },
          {
            title: "Fieldnote mobile",
            description: "Offline-first research app — designed the sync states reviewers called 'finally, honest UX'.",
            coverAssetId: "",
            link: "https://nadia.example/case/fieldnote",
            tags: ["mobile", "research tools"],
          },
        ],
      }),
      block("visuals", "gallery", { assetIds: [], layout: "grid", columns: 3 }),
      block("voices", "testimonials", {
        items: [
          {
            quote: "Nadia asks the question your metrics were too polite to ask. The redesign paid for itself in a quarter.",
            name: "Tom Aldana",
            role: "CPO, Ledgerline",
          },
          {
            quote: "Every handoff arrived with the 'why' written down. Our engineers still reference the spec.",
            name: "Grace Yu",
            role: "Eng Lead, Fieldnote",
          },
        ],
      }),
      block("inquiry", "form-embed", INQUIRY_EMBED),
      block("elsewhere", "contact-links", {
        links: [
          { type: "email", url: "mailto:hi@nadia.example" },
          { type: "dribbble", url: "https://dribbble.com/nadia" },
          { type: "linkedin", url: "https://www.linkedin.com/in/nadia" },
        ],
      }),
    ],
    {
      settings: settings({
        seoTitle: "Nadia Rahman — product designer",
        seoDescription: "Portfolio of product designer Nadia Rahman — fintech, developer tools and design systems.",
        progressBar: false,
      }),
    },
  ),
};

export const photographerPortfolio: TemplateDefinition = {
  meta: {
    id: "photographer-portfolio",
    name: "Photography portfolio",
    description:
      "A quiet, serif-driven portfolio that lets masonry galleries breathe, frames photo series as projects, and books shoots through an embedded form.",
    category: "portfolio",
    tags: ["photography", "freelance"],
    gradient: "from-zinc-500 via-neutral-600 to-stone-800",
    accent: "#78716c",
  },
  body: doc(
    "portfolio",
    theme({
      bg: "#0c0a09",
      fg: "#e7e5e4",
      primary: "#d6d3d1",
      primaryFg: "#0c0a09",
      muted: "#a8a29e",
      border: "#292524",
      radius: "none",
      fontHeading: FONTS.serif,
      fontBody: FONTS.serif,
    }),
    [
      block("hero", "hero", {
        title: "Mara Ellison — photographer",
        subtitle: "Documentary and editorial photography from the Atlantic coast. Available for commissions worldwide, spring through autumn.",
        cta: { label: "Book a shoot", href: "#booking" },
      }),
      block("selected", "gallery", { assetIds: [], layout: "masonry", columns: 3 }),
      block("series", "projects", {
        items: [
          {
            title: "Tidelines (2025)",
            description: "A year of dawn walks on the same 400 metres of beach. 42 plates, hand-bound edition of 100.",
            coverAssetId: "",
            link: "https://mara.example/tidelines",
            tags: ["documentary", "book"],
          },
          {
            title: "Harbour Voices",
            description: "Portrait series commissioned by the Maritime Museum — fishermen, welders, lighthouse keepers.",
            coverAssetId: "",
            link: "https://mara.example/harbour",
            tags: ["portrait", "commission"],
          },
        ],
      }),
      block("about", "text", {
        richText:
          "<h3>About</h3><p>I work slowly and locally: one coast, many seasons. My editorial work has appeared in national weekend supplements and two small-press books. Prints ship worldwide from the studio in Falmouth.</p>",
      }),
      block("booking", "form-embed", INQUIRY_EMBED),
      block("write", "contact-links", {
        links: [
          { type: "email", url: "mailto:studio@mara.example" },
          { type: "instagram", url: "https://instagram.com/mara.ellison" },
        ],
      }),
    ],
    {
      settings: settings({
        seoTitle: "Mara Ellison — photographer",
        seoDescription: "Documentary and editorial photography from the Atlantic coast. Commissions and prints.",
        progressBar: false,
      }),
    },
  ),
};

export const developerPortfolio: TemplateDefinition = {
  meta: {
    id: "developer-portfolio",
    name: "Developer portfolio",
    description:
      "A mono-flavored portfolio for engineers: shipped projects with tags and links, a straight-talking about section and an embedded hire-me form.",
    category: "portfolio",
    tags: ["engineering", "career"],
    gradient: "from-emerald-500 via-green-600 to-teal-700",
    accent: "#059669",
  },
  body: doc(
    "portfolio",
    theme({
      bg: "#0a0f0d",
      fg: "#d1fae5",
      primary: "#34d399",
      primaryFg: "#0a0f0d",
      muted: "#6ee7b7",
      border: "#064e3b",
      radius: "sm",
      fontHeading: FONTS.mono,
      fontBody: FONTS.sans,
    }),
    [
      block("hero", "hero", {
        title: "kenji.dev — full-stack engineer",
        subtitle: "TypeScript, Postgres and the unglamorous work that keeps products up. Currently open to contract work for Q3.",
        cta: { label: "Hire me", href: "#hire" },
      }),
      block("stack", "text", {
        richText:
          "<h3>What I do</h3><p>Ten years shipping web products: four at startups where the pager was mine, six consulting where uptime became a habit. Strongest with <strong>Node/TypeScript</strong>, <strong>Postgres</strong> and <strong>React</strong>; happiest owning a feature from schema to screenshot.</p>",
      }),
      block("shipped", "projects", {
        items: [
          {
            title: "Queuecast",
            description: "Job-queue dashboard with replay and backpressure insights. 900+ GitHub stars, used by three unicorns.",
            coverAssetId: "",
            link: "https://github.com/kenji/queuecast",
            tags: ["typescript", "oss"],
          },
          {
            title: "Ferry times API",
            description: "Open data scraper + API for island ferry schedules. Powers two transit apps and one very happy B&B owner.",
            coverAssetId: "",
            link: "https://ferries.kenji.dev",
            tags: ["go", "scraping"],
          },
          {
            title: "Railyard",
            description: "Model-train inventory PWA with barcode scanning — because side projects should stay fun.",
            coverAssetId: "",
            link: "https://railyard.kenji.dev",
            tags: ["react", "pwa"],
          },
        ],
      }),
      block("faq", "faq", {
        items: [
          { q: "What engagements do you take?", a: "3–12 week contracts, remote-first with quarterly overlap weeks in EU time zones." },
          { q: "Do you join existing codebases?", a: "Most of my work is rescue-and-ship: arriving at a repo that needs momentum more than rewrites." },
          { q: "How do we start?", a: "Send the form below with a paragraph on the problem. You'll get a reply within two working days." },
        ],
      }),
      block("hire", "form-embed", INQUIRY_EMBED),
      block("code", "contact-links", {
        links: [
          { type: "email", url: "mailto:hello@kenji.dev" },
          { type: "github", url: "https://github.com/kenji" },
          { type: "mastodon", url: "https://mastodon.social/@kenji" },
        ],
      }),
    ],
    {
      settings: settings({
        seoTitle: "kenji.dev — full-stack engineer",
        seoDescription: "TypeScript, Postgres and React contractor. Open for Q3 bookings.",
        progressBar: false,
      }),
    },
  ),
};

export const studioPortfolio: TemplateDefinition = {
  meta: {
    id: "studio-portfolio",
    name: "Creative studio portfolio",
    description:
      "Two-person motion and brand studio: services up front, commissioned work in a grid, day-rate packages and an embedded brief form.",
    category: "portfolio",
    tags: ["studio", "motion"],
    gradient: "from-rose-500 via-red-400 to-amber-400",
    accent: "#f43f5e",
  },
  body: doc(
    "portfolio",
    theme({ bg: "#fff1f2", fg: "#4c0519", primary: "#e11d48", primaryFg: "#ffffff", muted: "#9f1239", border: "#fecdd3", radius: "full", fontHeading: FONTS.serif }),
    [
      block("hero", "hero", {
        title: "Foxglove & Co — motion with manners",
        subtitle: "A two-person studio making brand films, product loops and title sequences that clients can actually approve on the first cut.",
        cta: { label: "Brief us", href: "#brief" },
      }),
      block("services", "columns", {
        count: 3,
        children: [
          block("s1", "text", { richText: "<h4>Brand films</h4><p>60–90 second hero films, from script to final mix.</p>" }),
          block("s2", "text", { richText: "<h4>Product loops</h4><p>Silent, subtitled loops for launches, stores and conferences.</p>" }),
          block("s3", "text", { richText: "<h4>Title sequences</h4><p>Titles and idents for events, podcasts and small screens.</p>" }),
        ],
      }),
      block("reel", "gallery", { assetIds: [], layout: "grid", columns: 2 }),
      block("work", "projects", {
        items: [
          {
            title: "Northwind — 'Cold Start'",
            description: "Launch film for a weather-hardened laptop. 2.1M views, zero paid placement.",
            coverAssetId: "",
            link: "https://foxglove.example/northwind",
            tags: ["brand film"],
          },
          {
            title: "Pebble Bank idents",
            description: "Twelve idents for a streaming service's documentary strand.",
            coverAssetId: "",
            link: "https://foxglove.example/pebble",
            tags: ["titles"],
          },
        ],
      }),
      block("rates", "pricing", {
        tiers: [
          { name: "Day rate", price: "€900", features: ["One studio day", "Rough cut in 48h", "Remote review"], cta: { label: "Book days", href: "#brief" } },
          { name: "Product loop", price: "€3.5k", features: ["Up to 30s loop", "2 revision rounds", "All aspect ratios"], cta: { label: "Order a loop", href: "#brief" } },
          { name: "Brand film", price: "from €9k", features: ["Script to final mix", "Original score license", "4-week schedule"], cta: { label: "Start a film", href: "#brief" } },
        ],
      }),
      block("brief", "form-embed", INQUIRY_EMBED),
      block("follow", "contact-links", {
        links: [
          { type: "email", url: "mailto:studio@foxglove.example" },
          { type: "vimeo", url: "https://vimeo.com/foxglove" },
          { type: "instagram", url: "https://instagram.com/foxglove.studio" },
        ],
      }),
    ],
    {
      settings: settings({
        seoTitle: "Foxglove & Co — motion studio",
        seoDescription: "Brand films, product loops and title sequences from a two-person studio.",
        progressBar: false,
      }),
    },
  ),
};

/** All portfolio templates, in gallery order. */
export const portfolioTemplates: TemplateDefinition[] = [
  designerPortfolio,
  photographerPortfolio,
  developerPortfolio,
  studioPortfolio,
];
