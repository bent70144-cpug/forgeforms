// Seed templates — FORMS (spec §7.2 block catalog, §14.1.9).
// 7 form templates with original marketing copy.
import type { TemplateDefinition } from "../types";

export const contactForm: TemplateDefinition = {
  meta: {
    id: "contact-form",
    name: "Contact us",
    description:
      "A friendly contact form that routes inquiries by topic so sales, support and partnerships each get the right message.",
    category: "form",
    tags: ["support", "sales"],
    gradient: "from-indigo-500 via-blue-500 to-cyan-400",
    accent: "#4f46e5",
  },
  body: doc(
    "form",
    theme({ primary: "#4f46e5", radius: "lg" }),
    [
      block(
        "intro",
        "text",
        {
          richText:
            "<h3>Get in touch</h3><p>Tell us a little about what you need and the right team will reply within one business day.</p>",
        },
      ),
      question("name", "short-text", {
        label: "What's your name?",
        placeholder: "Ada Lovelace",
        buttonText: "Continue",
      }),
      question("email", "email", { label: "Where can we reply?", buttonText: "Continue" }),
      question("company", "short-text", {
        label: "Company or team",
        description: "Optional — helps us give you a more relevant answer.",
        placeholder: "Acme Inc.",
        required: false,
        buttonText: "Continue",
      }),
      question("topic", "single-select", {
        label: "What's this about?",
        options: options("topic", ["Sales and pricing", "Product support", "Partnerships", "Something else"]),
        allowOther: true,
        buttonText: "Continue",
      }),
      question("message", "long-text", {
        label: "Your message",
        placeholder: "A few sentences about your project, question or bug…",
        maxLength: 2000,
        buttonText: "Send message",
      }),
    ],
    {
      settings: settings({
        seoTitle: "Contact FormForge",
        seoDescription: "Questions about FormForge? Send us a note and we'll reply within one business day.",
        progressBar: false,
      }),
      endings: [
        ending("thanks", "Thanks — message received!", "We've routed it to the right team. Expect a reply within one business day."),
      ],
    },
  ),
};

export const customerFeedback: TemplateDefinition = {
  meta: {
    id: "customer-feedback",
    name: "Customer feedback survey",
    description:
      "A five-star rating opens the door: happy customers tell you what to double down on, unhappy ones go straight to what to fix.",
    category: "form",
    tags: ["survey", "cx"],
    gradient: "from-amber-400 via-orange-500 to-rose-400",
    accent: "#f59e0b",
  },
  body: doc(
    "form",
    theme({ primary: "#f59e0b", fg: "#1c1917", bg: "#fffbeb", radius: "md", border: "#fde68a", muted: "#92703c" }),
    [
      block(
        "intro",
        "text",
        {
          richText:
            "<h3>How did we do?</h3><p>Two minutes of your time, and you shape what we build next. Answers are anonymous unless you leave your email.</p>",
        },
      ),
      question("rate", "rating", {
        label: "Overall, how would you rate your experience?",
        scale: 5,
        icon: "star",
        buttonText: "Continue",
      }),
      question("liked", "multi-select", {
        label: "What stood out to you?",
        description: "Pick everything that applied.",
        options: options("liked", ["Speed", "Design", "Support team", "Value for money", "Integrations"]),
        max: 5,
        buttonText: "Continue",
      }),
      question("improve", "long-text", {
        label: "What could we do better?",
        placeholder: "Be as blunt as you like — it helps more than praise.",
        maxLength: 1500,
        buttonText: "Continue",
      }),
      question("followup", "email", {
        label: "Want a follow-up from our team?",
        description: "Optional. We'll only use it to reply to this survey.",
        required: false,
        buttonText: "Submit feedback",
      }),
    ],
    {
      settings: settings({ seoTitle: "Customer feedback", seoDescription: "Tell us how we're doing." }),
      endings: [ending("thanks", "Thank you!", "Your feedback goes straight to the product team every Friday.")],
      rules: [
        // Unhappy raters skip the "what stood out" question and go straight to the fix-it box.
        rule("r_rate_low", "rate", [cond("@block:rate", "lte", 2)], [goto("improve")]),
      ],
    },
  ),
};

export const npsSurvey: TemplateDefinition = {
  meta: {
    id: "nps-survey",
    name: "NPS survey",
    description:
      "The classic 0–10 recommendation score with branching: promoters get a spotlight question, everyone else tells you what would win them over.",
    category: "form",
    tags: ["survey", "nps"],
    gradient: "from-violet-500 via-purple-500 to-fuchsia-500",
    accent: "#8b5cf6",
  },
  body: doc(
    "form",
    theme({ primary: "#8b5cf6", radius: "full" }),
    [
      block("intro", "text", {
        richText: "<h3>One question, ten seconds</h3><p>Help us understand how likely you'd be to recommend us — and why.</p>",
      }),
      question("nps1", "nps", {
        label: "How likely are you to recommend FormForge to a colleague?",
        leftLabel: "Not at all likely",
        rightLabel: "Extremely likely",
        buttonText: "Continue",
      }),
      question("promoter", "short-text", {
        label: "Amazing — what's the one thing you love most?",
        placeholder: "e.g. the logic builder",
        buttonText: "Finish",
      }),
      question("improve", "long-text", {
        label: "What would make your experience a 10?",
        placeholder: "Missing features, pricing, support — anything goes.",
        maxLength: 1000,
        buttonText: "Finish",
      }),
    ],
    {
      settings: settings({
        seoTitle: "NPS — FormForge",
        seoDescription: "How likely are you to recommend FormForge?",
        progressBar: true,
      }),
      endings: [
        ending("cheers", "Thank you! 🎉", "Scores like yours keep us building."),
        ending("heard", "Thanks — we're on it.", "Your note lands with the team that can fix it."),
      ],
      rules: [
        // Promoters (9–10) skip the improvement box and get the spotlight question.
        rule("r_nps_high", "nps1", [cond("@block:nps1", "gte", 9)], [goto("promoter")]),
        // Passives/detractors finish on the "heard" ending after "what would make it a 10".
        rule("r_improve_done", "improve", [], [goto("end:heard")], true),
      ],
    },
  ),
};

export const eventRsvp: TemplateDefinition = {
  meta: {
    id: "event-rsvp",
    name: "Event RSVP",
    description:
      "Collect RSVPs for meetups and launches, count guests automatically, and politely close the loop with anyone who can't make it.",
    category: "form",
    tags: ["events", "community"],
    gradient: "from-emerald-400 via-teal-500 to-cyan-500",
    accent: "#10b981",
  },
  body: doc(
    "form",
    theme({ primary: "#0d9488", bg: "#f0fdfa", fg: "#134e4a", border: "#99f6e4", muted: "#0f766e", radius: "lg" }),
    [
      block("intro", "text", {
        richText:
          "<h3>You're invited: FormForge Launch Night 🚀</h3><p>Thursday, June 12 · 6:30 pm · The Foundry, Portland OR. Demos, lightning talks and pizza. RSVP below — it's free.</p>",
      }),
      question("name", "short-text", { label: "Your name", placeholder: "Grace Hopper", buttonText: "Continue" }),
      question("email", "email", { label: "Email for the calendar invite", buttonText: "Continue" }),
      question("attending", "single-select", {
        label: "Will you join us?",
        options: options("attending", ["Yes — count me in!", "No, I can't make it", "Maybe — I'll confirm later"]),
        buttonText: "Continue",
      }),
      question("guests", "number", {
        label: "Including yourself, how many people are coming?",
        description: "We'll save seats and order pizza accordingly.",
        min: 1,
        max: 5,
        required: false,
        buttonText: "Continue",
      }),
      question("dietary", "long-text", {
        label: "Anything we should know?",
        description: "Dietary requirements, accessibility needs, plus-ones with questions…",
        required: false,
        maxLength: 500,
        buttonText: "Send RSVP",
      }),
    ],
    {
      settings: settings({
        seoTitle: "RSVP — FormForge Launch Night",
        seoDescription: "RSVP for FormForge Launch Night — June 12, Portland OR.",
        notifyEmails: ["events@formforge.test"],
      }),
      endings: [
        ending("confirmed", "You're on the list! 🎟️", "Calendar invite is on its way. See you on June 12."),
        ending("regrets", "Sorry you'll miss it!", "No worries — we'll send the replay and save you a spot next time."),
      ],
      rules: [
        // "No" respondents jump straight to the regrets ending, skipping guest counts.
        rule("r_no_show", "attending", [cond("@block:attending", "eq", "attending-o2")], [goto("end:regrets")]),
      ],
    },
  ),
};

export const jobApplication: TemplateDefinition = {
  meta: {
    id: "job-application",
    name: "Job application",
    description:
      "A structured application form with role selection, cover letter and résumé upload — one flow instead of a PDF graveyard.",
    category: "form",
    tags: ["hr", "hiring"],
    gradient: "from-slate-600 via-slate-700 to-slate-900",
    accent: "#334155",
  },
  body: doc(
    "form",
    theme({ primary: "#0f172a", primaryFg: "#f8fafc", bg: "#f8fafc", fg: "#0f172a", border: "#e2e8f0", muted: "#64748b", radius: "md" }),
    [
      block("intro", "text", {
        richText:
          "<h3>Join FormForge</h3><p>We're a small team building the document engine behind a million forms. Tell us who you are and show us what you've made.</p>",
      }),
      question("role", "dropdown", {
        label: "Which role are you applying for?",
        options: options("role", ["Full-stack Engineer", "Frontend Engineer", "Product Designer", "Technical Writer"]),
        searchable: false,
        buttonText: "Continue",
      }),
      question("name", "short-text", { label: "Full name", placeholder: "Joan Clarke", buttonText: "Continue" }),
      question("email", "email", { label: "Email", buttonText: "Continue" }),
      question("portfolio", "short-text", {
        label: "Portfolio, GitHub or personal site",
        description: "Optional, but it's the fastest way to impress us.",
        placeholder: "https://you.example",
        required: false,
        buttonText: "Continue",
      }),
      question("cover", "long-text", {
        label: "Why FormForge?",
        placeholder: "Skip the boilerplate — tell us what you'd bring and what you want to learn.",
        maxLength: 3000,
        buttonText: "Continue",
      }),
      question("resume", "file-upload", {
        label: "Your résumé",
        accept: [".pdf", ".doc", ".docx"],
        maxSizeMb: 10,
        maxFiles: 1,
        buttonText: "Submit application",
      }),
    ],
    {
      settings: settings({
        seoTitle: "Careers — Apply to FormForge",
        seoDescription: "Apply to open roles at FormForge in under five minutes.",
        captcha: true,
      }),
      endings: [
        ending("end_received", "Application received ✅", "We read every application. If there's a fit, you'll hear from us within a week."),
      ],
    },
  ),
};

export const productQuiz: TemplateDefinition = {
  meta: {
    id: "product-quiz",
    name: "Knowledge quiz",
    description:
      "A three-question gate quiz with instant pass/fail branching — perfect for onboarding checks, training and certifications.",
    category: "form",
    tags: ["quiz", "education"],
    gradient: "from-pink-500 via-rose-500 to-orange-400",
    accent: "#ec4899",
  },
  body: doc(
    "form",
    theme({ primary: "#ec4899", bg: "#fdf2f8", fg: "#500724", border: "#fbcfe8", muted: "#be185d", radius: "lg" }),
    [
      block("intro", "text", {
        richText:
          "<h3>FormForge basics check</h3><p>Three questions about the building blocks. Get all three right to earn the <strong>Form Rookie</strong> badge. One wrong answer sends you back to the docs — no pressure.</p>",
      }),
      question("q1", "single-select", {
        label: "1 · Which question block collects a 0–10 recommendation score?",
        options: options("q1", ["NPS", "Rating", "Number", "Dropdown"]),
        buttonText: "Lock it in",
      }),
      question("q2", "single-select", {
        label: "2 · What does the logic engine use to route respondents after a question?",
        options: options("q2", ["Webhooks", "Rules with goto targets", "Cron jobs", "CSS selectors"]),
        buttonText: "Lock it in",
      }),
      question("q3", "single-select", {
        label: "3 · Which document type powers a portfolio site?",
        options: options("q3", ["form", "page", "portfolio"]),
        buttonText: "Finish quiz",
      }),
    ],
    {
      settings: settings({ seoTitle: "FormForge basics check", progressBar: true }),
      endings: [
        ending("pass", "Passed — nice work! 🏅", "You're officially a Form Rookie. Share your badge with the team."),
        ending("retry", "Not quite!", "Revisit the docs and take the quiz again — it's the same three questions, no tricks."),
      ],
      rules: [
        rule("r_q1", "q1", [cond("@block:q1", "neq", "q1-o1")], [goto("end:retry")]),
        rule("r_q2", "q2", [cond("@block:q2", "neq", "q2-o2")], [goto("end:retry")]),
        rule("r_q3", "q3", [cond("@block:q3", "neq", "q3-o3")], [goto("end:retry")]),
      ],
    },
  ),
};

export const newsletterSignup: TemplateDefinition = {
  meta: {
    id: "newsletter-signup",
    name: "Newsletter signup",
    description:
      "A three-step signup that qualifies interest while it collects the address — readers segment themselves before they even subscribe.",
    category: "form",
    tags: ["marketing", "email"],
    gradient: "from-sky-400 via-blue-500 to-indigo-500",
    accent: "#0ea5e9",
  },
  body: doc(
    "form",
    theme({ primary: "#0284c7", bg: "#f0f9ff", fg: "#0c4a6e", border: "#bae6fd", muted: "#0369a1", radius: "full" }),
    [
      block("intro", "text", {
        richText:
          "<h3>The Forge Weekly</h3><p>One email every Thursday: what we shipped, what we learned, and the best form-building tricks we saw that week.</p>",
      }),
      question("email", "email", { label: "Your best email", buttonText: "Continue" }),
      question("interest", "single-select", {
        label: "What should we send you?",
        options: options("interest", ["Product updates only", "Engineering deep-dives", "Everything — go wild"]),
        buttonText: "Subscribe",
      }),
    ],
    {
      settings: settings({ seoTitle: "The Forge Weekly — signup", progressBar: false }),
      endings: [ending("subscribed", "You're in! 📬", "First issue lands Thursday. No spam, unsubscribe anytime.")],
    },
  ),
};

/** All form templates, in gallery order. */
export const formTemplates: TemplateDefinition[] = [
  contactForm,
  customerFeedback,
  npsSurvey,
  eventRsvp,
  jobApplication,
  productQuiz,
  newsletterSignup,
];
