// Seed templates — PAGES / landing pages (spec §7.2 block catalog, §14.1.9).
// 5 landing-page templates with original marketing copy.
import type { TemplateDefinition } from "../types";
import { block, doc, FONTS, settings, theme } from "./helpers";

export const productLanding: TemplateDefinition = {
  meta: {
    id: "product-landing",
    name: "SaaS product landing",
    description:
      "Dark, confident launch page: hero with call to action, three-column feature pitch, social proof, pricing and an FAQ that pre-empts objections.",
    category: "page",
    tags: ["saas", "launch"],
    gradient: "from-blue-600 via-indigo-600 to-violet-600",
    accent: "#6366f1",
  },
  body: doc(
    "page",
    theme({
      bg: "#0b1220",
      fg: "#e2e8f0",
      primary: "#818cf8",
      primaryFg: "#0b1220",
      muted: "#94a3b8",
      border: "#1e293b",
      radius: "lg",
      fontHeading: FONTS.sans,
    }),
    [
      block("hero", "hero", {
        title: "Meet Pulse — analytics that answers, not overwhelms",
        subtitle:
          "Pulse watches your product around the clock and pings you only when something actually matters. Set up in minutes, no SQL required.",
        cta: { label: "Start free trial", href: "/register" },
      }),
      block("features", "columns", {
        count: 3,
        children: [
          block("f1", "text", {
            richText:
              "<h4>Anomaly alerts</h4><p>Thresholds that learn your baselines. Get a nudge before a bad deploy becomes a bad week.</p>",
          }),
          block("f2", "text", {
            richText:
              "<h4>Ask-anything reports</h4><p>Type a question in plain English and get a chart back. Every chart is shareable by link.</p>",
          }),
          block("f3", "text", {
            richText:
              "<h4>Privacy first</h4><p>Cookieless by default, EU hosting on request, and a data map your DPO will actually enjoy reading.</p>",
          }),
        ],
      }),
      block("proof", "testimonials", {
        items: [
          {
            quote: "We cut our alert noise by 80% in the first week. Pulse is the first dashboard my team actually opens.",
            name: "Maya Okafor",
            role: "Head of Product, Northbeam",
          },
          {
            quote: "The ask-anything reports replaced three internal tools. My PMs stopped pinging me for numbers.",
            name: "Daniel Reyes",
            role: "CTO, Loamly",
          },
          {
            quote: "Setup took eleven minutes, including the part where I second-guessed myself twice.",
            name: "Priya Natarajan",
            role: "Founder, Kite & Co.",
          },
        ],
      }),
      block("pricing", "pricing", {
        tiers: [
          { name: "Starter", price: "$0", features: ["3 dashboards", "7-day retention", "Community support"], cta: { label: "Start free", href: "/register" } },
          { name: "Growth", price: "$49/mo", features: ["Unlimited dashboards", "Anomaly alerts", "Slack + email digests", "12-month retention"], cta: { label: "Try Growth", href: "/register?plan=growth" } },
          { name: "Scale", price: "Custom", features: ["SSO & audit log", "EU residency", "Dedicated success engineer"], cta: { label: "Talk to us", href: "/contact" } },
        ],
      }),
      block("faq", "faq", {
        items: [
          { q: "Do you replace our existing analytics?", a: "No — Pulse sits on top. Connect your warehouse or product events and we handle the watching and summarizing." },
          { q: "How long does setup take?", a: "Most teams see their first alert within 15 minutes. The SDK is one script tag or one npm install." },
          { q: "Is there a free plan?", a: "Yes, and it's not a trial. Three dashboards and 7-day retention, forever." },
          { q: "Can we self-host?", a: "Scale customers can run Pulse in their own VPC. Talk to us about the details." },
        ],
      }),
      block("cta", "button", { label: "Start your free trial", href: "/register", style: "primary" }),
    ],
    {
      settings: settings({
        seoTitle: "Pulse — analytics that answers, not overwhelms",
        seoDescription: "Anomaly alerts and ask-anything reports for product teams. Free to start.",
        progressBar: false,
      }),
    },
  ),
};

export const waitlistPage: TemplateDefinition = {
  meta: {
    id: "waitlist-page",
    name: "Waitlist launch page",
    description:
      "A pre-launch teaser that sells the promise, answers the obvious questions and funnels every visitor toward joining the waitlist.",
    category: "page",
    tags: ["pre-launch", "waitlist"],
    gradient: "from-lime-400 via-emerald-400 to-teal-500",
    accent: "#10b981",
  },
  body: doc(
    "page",
    theme({ bg: "#f7fee7", fg: "#14532d", primary: "#16a34a", primaryFg: "#f7fee7", muted: "#4d7c0f", border: "#d9f99d", radius: "full" }),
    [
      block("hero", "hero", {
        title: "Batch — group decisions without the group chat chaos",
        subtitle: "We're building the calendar that coordinates friends, not just meetings. Launching this fall — 4,182 people already in line.",
        cta: { label: "Join the waitlist", href: "/register" },
      }),
      block("how", "text", {
        richText:
          "<h3>Why a waitlist?</h3><p>We're onboarding in small waves so every group gets a white-glove start. Jump in early and you'll help shape how Batch decides.</p><ul><li><strong>Wave 1</strong> — close friends & beta families (open)</li><li><strong>Wave 2</strong> — waitlist in signup order (September)</li><li><strong>Wave 3</strong> — public launch (November)</li></ul>",
      }),
      block("faq", "faq", {
        items: [
          { q: "When does Batch launch?", a: "Public launch is planned for November. Waitlist waves roll out through September and October." },
          { q: "Will it be free?", a: "Planning groups of up to 5 will be free forever. Batch Pro adds bigger groups, polls and smart scheduling." },
          { q: "Which platforms?", a: "iOS and Android first, with a web app for the friend who refuses to install anything." },
          { q: "Can I move up the list?", a: "Yes — sharing your referral link bumps you one spot per friend who joins." },
        ],
      }),
      block("social", "testimonials", {
        items: [
          {
            quote: "We planned a 9-person trip in Batch's beta with fewer messages than picking a restaurant usually takes.",
            name: "Tomas Lindgren",
            role: "Beta tester since April",
          },
          {
            quote: "It's the first calendar app my whole friend group actually kept open.",
            name: "Aisha Bello",
            role: "Beta tester since May",
          },
        ],
      }),
    ],
    {
      settings: settings({
        seoTitle: "Batch — join the waitlist",
        seoDescription: "Group decisions without the group chat chaos. Join 4,182 people on the Batch waitlist.",
        progressBar: false,
      }),
    },
  ),
};

export const pricingPage: TemplateDefinition = {
  meta: {
    id: "pricing-page",
    name: "Pricing page",
    description:
      "A no-surprises pricing page: three clearly separated tiers, feature lists that answer real questions, and an FAQ for the edge cases.",
    category: "page",
    tags: ["pricing", "saas"],
    gradient: "from-cyan-500 via-sky-500 to-blue-600",
    accent: "#0ea5e9",
  },
  body: doc(
    "page",
    theme({ bg: "#ffffff", fg: "#0c4a6e", primary: "#0284c7", primaryFg: "#ffffff", muted: "#0369a1", border: "#e0f2fe", radius: "lg" }),
    [
      block("intro", "text", {
        richText:
          "<h3>Pricing that scales with you, not against you</h3><p>Every plan includes unlimited documents, unlimited submissions and the full block library. Upgrade only when you need more power.</p>",
      }),
      block("tiers", "pricing", {
        tiers: [
          { name: "Free", price: "$0", features: ["Unlimited forms & pages", "1,000 submissions/mo", "FormForge branding", "Community support"], cta: { label: "Start free", href: "/register" } },
          { name: "Pro", price: "$19/mo", features: ["Remove branding", "Custom domain", "3 team seats", "Advanced analytics", "Partial submissions"], cta: { label: "Go Pro", href: "/register?plan=pro" } },
          { name: "Business", price: "$59/mo", features: ["5 custom domains", "10 team seats", "Webhooks & API", "Priority support", "50 MB uploads"], cta: { label: "Choose Business", href: "/register?plan=business" } },
        ],
      }),
      block("faq", "faq", {
        items: [
          { q: "What counts as a submission?", a: "A submission is counted when someone completes your form. Starts, drafts and abandons are always free." },
          { q: "Can I change plans later?", a: "Anytime. Upgrades apply immediately and we prorate the difference; downgrades take effect next cycle." },
          { q: "Do you offer discounts?", a: "Non-profits and educators get 50% off Pro — write to hello@formforge.test from your organization address." },
          { q: "What happens if I cancel?", a: "Your documents become view-only, nothing is deleted. Export your data as CSV whenever you like." },
        ],
      }),
      block("talk", "contact-links", {
        links: [
          { type: "email", url: "mailto:hello@formforge.test" },
          { type: "x", url: "https://x.com/formforge" },
          { type: "linkedin", url: "https://www.linkedin.com/company/formforge" },
        ],
      }),
    ],
    {
      settings: settings({
        seoTitle: "Pricing — FormForge",
        seoDescription: "Simple, generous pricing for forms, landing pages and portfolios.",
        progressBar: false,
      }),
    },
  ),
};

export const eventLanding: TemplateDefinition = {
  meta: {
    id: "event-landing",
    name: "Event landing page",
    description:
      "A conference-style page with an embedded trailer video, agenda highlights and speaker-grade social proof — built to fill seats.",
    category: "page",
    tags: ["events", "conference"],
    gradient: "from-orange-500 via-red-500 to-rose-600",
    accent: "#f97316",
  },
  body: doc(
    "page",
    theme({ bg: "#1c0a03", fg: "#ffedd5", primary: "#f97316", primaryFg: "#1c0a03", muted: "#fdba74", border: "#7c2d12", radius: "md", fontHeading: FONTS.serif }),
    [
      block("hero", "hero", {
        title: "ForgeConf 2026 — where documents get built",
        subtitle: "October 8–9 · Berlin. Two days of builders, block architecture and live ship-it sessions. Early-bird tickets are live now.",
        cta: { label: "Get early-bird tickets", href: "/register" },
      }),
      block("trailer", "video", { url: "https://www.youtube.com/watch?v=ScMzIvxBSi4" }),
      block("agenda", "text", {
        richText:
          "<h3>Day one highlights</h3><ul><li><strong>10:00</strong> — Keynote: one model to render them all</li><li><strong>11:30</strong> — Deep dive: the logic engine, from rules to runtime</li><li><strong>14:00</strong> — Workshop: ship a portfolio in 30 minutes</li><li><strong>17:00</strong> — Lightning talks & rooftop social</li></ul><p>Full agenda lands with the speaker lineup in August.</p>",
      }),
      block("voices", "testimonials", {
        items: [
          {
            quote: "ForgeConf is the only conference where I watched someone build a working form before my coffee cooled.",
            name: "Lena Fischer",
            role: "Attendee, 2025",
          },
          {
            quote: "The workshop alone justified the flight. I shipped our careers page on the train home.",
            name: "Marc Dubois",
            role: "Attendee, 2025",
          },
          {
            quote: "Berlin, builders, and zero vendor-keyword Bingo. See you in October.",
            name: "Sofia Marín",
            role: "Attendee, 2024 & 2025",
          },
        ],
      }),
      block("cta", "button", { label: "Get early-bird tickets — €149", href: "/register", style: "primary" }),
    ],
    {
      settings: settings({
        seoTitle: "ForgeConf 2026 — Berlin",
        seoDescription: "Two days of builders, block architecture and live ship-it sessions. October 8–9, Berlin.",
        progressBar: false,
      }),
    },
  ),
};

export const agencyLanding: TemplateDefinition = {
  meta: {
    id: "agency-landing",
    name: "Studio agency page",
    description:
      "A portfolio-flavored agency page: selected case studies, client voices, engagement packages and direct contact links.",
    category: "page",
    tags: ["agency", "services"],
    gradient: "from-stone-800 via-stone-700 to-amber-600",
    accent: "#d97706",
  },
  body: doc(
    "page",
    theme({ bg: "#1c1917", fg: "#fafaf9", primary: "#f59e0b", primaryFg: "#1c1917", muted: "#a8a29e", border: "#44403c", radius: "md", fontHeading: FONTS.serif }),
    [
      block("hero", "hero", {
        title: "Hardbound Studio — brands with spine",
        subtitle: "We design identities and sites for independent publishers. Nine years, sixty-plus launches, zero templates.",
        cta: { label: "See our work", href: "#work" },
      }),
      block("work", "projects", {
        items: [
          {
            title: "Meridian Press",
            description: "Identity and site for a literary imprint — 40% lift in newsletter signups after relaunch.",
            coverAssetId: "",
            link: "https://meridianpress.example",
            tags: ["identity", "web"],
          },
          {
            title: "Cartographer's Kitchen",
            description: "Cookbook publisher with an interactive recipe atlas. Shortlisted for the 2025 Edition Awards.",
            coverAssetId: "",
            link: "https://cartographerskitchen.example",
            tags: ["web", "interactive"],
          },
          {
            title: "Inkwell Quarterly",
            description: "Subscription redesign that cut churn by a third in two issues.",
            coverAssetId: "",
            link: "https://inkwell.example",
            tags: ["product", "retention"],
          },
        ],
      }),
      block("clients", "testimonials", {
        items: [
          {
            quote: "Hardbound treated our brand like a manuscript worth editing, not a deck to decorate.",
            name: "Ruth Okafor",
            role: "Publisher, Meridian Press",
          },
          {
            quote: "They ship like engineers and argue like editors. Exactly what a publisher needs.",
            name: "Jonas Weber",
            role: "Founder, Inkwell Quarterly",
          },
        ],
      }),
      block("engagements", "pricing", {
        tiers: [
          { name: "Sprint", price: "€6k", features: ["2-week identity tune-up", "Type & color system", "One-page site"], cta: { label: "Book a sprint", href: "mailto:studio@hardbound.example" } },
          { name: "Full launch", price: "€18k", features: ["Full identity", "Multi-page site", "Launch assets & handover"], cta: { label: "Start a project", href: "mailto:studio@hardbound.example" } },
          { name: "Partner", price: "Retainer", features: ["Ongoing design partner", "Quarterly brand reviews", "Priority scheduling"], cta: { label: "Talk retainers", href: "mailto:studio@hardbound.example" } },
        ],
      }),
      block("reach", "contact-links", {
        links: [
          { type: "email", url: "mailto:studio@hardbound.example" },
          { type: "instagram", url: "https://instagram.com/hardbound.studio" },
          { type: "linkedin", url: "https://www.linkedin.com/company/hardbound-studio" },
        ],
      }),
    ],
    {
      settings: settings({
        seoTitle: "Hardbound Studio — brands with spine",
        seoDescription: "Identity and web design for independent publishers.",
        progressBar: false,
      }),
    },
  ),
};

/** All page templates, in gallery order. */
export const pageTemplates: TemplateDefinition[] = [
  productLanding,
  waitlistPage,
  pricingPage,
  eventLanding,
  agencyLanding,
];
