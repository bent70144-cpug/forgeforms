// T15 — deterministic fixtures for the mock ResultsClient.
// A realistic feedback form (all MVP question kinds) + seeded submissions over
// the last 30 days. Deterministic under a fixed seed so tests can assert exact
// aggregates, and the UI demo behaves identically on every reload.

import type { DocumentSummary, SubmissionDTO } from "./types";

export const FIXTURE_SEED = 20261105;
export const FIXTURE_SUBMISSION_COUNT = 137;

export const FIXTURE_BLOCK_IDS = {
  name: "b_name",
  email: "b_email",
  source: "b_source",
  features: "b_features",
  setup: "b_setup",
  nps: "b_nps",
  feedback: "b_feedback",
} as const;

export const FIXTURE_DOCUMENT: DocumentSummary = {
  id: "doc_fixture0001",
  title: "Customer Feedback Survey",
  type: "form",
  status: "published",
  slug: "customer-feedback",
  updatedAt: "2026-11-01T09:30:00.000Z",
  body: {
    schemaVersion: 1,
    type: "form",
    theme: { tokens: {}, fontHeading: "Inter", fontBody: "Inter", radius: "md" },
    settings: {
      seo: {},
      locale: "en",
      progressBar: true,
      autoAdvance: true,
      showBranding: true,
      captcha: false,
      notifyEmails: ["team@example.com"],
    },
    blocks: [
      {
        id: "b_hero",
        kind: "hero",
        props: {
          title: "Customer Feedback Survey",
          subtitle: "Two minutes about your FormForge experience.",
        },
      },
      {
        id: FIXTURE_BLOCK_IDS.name,
        kind: "short-text",
        props: { label: "What's your name?", placeholder: "Ada Lovelace", required: true },
      },
      {
        id: FIXTURE_BLOCK_IDS.email,
        kind: "email",
        props: { label: "Your email address", required: true },
      },
      {
        id: FIXTURE_BLOCK_IDS.source,
        kind: "single-select",
        props: {
          label: "How did you hear about us?",
          allowOther: true,
          options: [
            { id: "opt_search", label: "Search engine" },
            { id: "opt_referral", label: "Referral" },
            { id: "opt_social", label: "Social media" },
            { id: "opt_podcast", label: "Podcast" },
          ],
        },
      },
      {
        id: FIXTURE_BLOCK_IDS.features,
        kind: "multi-select",
        props: {
          label: "Which FormForge features do you use?",
          options: [
            { id: "opt_forms", label: "Forms" },
            { id: "opt_pages", label: "Pages" },
            { id: "opt_logic", label: "Logic" },
            { id: "opt_exports", label: "Exports" },
            { id: "opt_webhooks", label: "Webhooks" },
          ],
        },
      },
      {
        id: FIXTURE_BLOCK_IDS.setup,
        kind: "rating",
        props: { label: "How easy was it to set up your first form?", scale: 5 },
      },
      {
        id: FIXTURE_BLOCK_IDS.nps,
        kind: "nps",
        props: {
          label: "How likely are you to recommend FormForge to a colleague?",
          leftLabel: "Not at all likely",
          rightLabel: "Extremely likely",
        },
      },
      {
        id: FIXTURE_BLOCK_IDS.feedback,
        kind: "long-text",
        props: { label: "Any feedback for the team?", required: false },
      },
    ],
    endings: [{ id: "end_thanks", title: "Thanks for your feedback!" }],
    logic: { rules: [] },
  },
};

// ---------------------------------------------------------------------------
// Seeded generator (mulberry32 — tiny, deterministic, dependency-free)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  "Ana", "Ben", "Clara", "Dmitri", "Elena", "Felix", "Grace", "Hugo", "Ines", "Jonas",
  "Katya", "Liam", "Mara", "Niko", "Olga", "Pavel", "Quinn", "Rosa", "Sam", "Tess",
] as const;

const LAST_NAMES = [
  "Alvarez", "Baker", "Chen", "Dubois", "Eriksson", "Fischer", "Garcia", "Haddad",
  "Ito", "Jansen", "Keller", "Lopez", "Meyer", "Novak", "Ortega", "Petrov",
] as const;

const FEEDBACK = [
  "The logic builder saved me hours — conditions just work.",
  "Would love a Slack integration for the notifications.",
  "Publishing felt instant. Nice work on the editor speed.",
  "The CSV export should include hidden fields, otherwise perfect.",
  "Portfolios look gorgeous out of the box.",
  "Took me a minute to find the webhook replay button.",
  "Webhooks are solid, delivery log is very transparent.",
  "Please add multi-language forms — my users are split DE/EN.",
  "The summary charts are exactly what my boss asked for.",
  "Minor: dark mode in the builder would be lovely.",
] as const;

const OTHER_SOURCES = ["Reddit thread", "Conference talk", "Newsletter"] as const;

const DEVICES = ["desktop", "mobile", "tablet"] as const;
const COUNTRIES = ["US", "GB", "DE", "IN", "BR"] as const;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export interface FixtureOptions {
  count?: number;
  seed?: number;
  /** Injectable clock for fully deterministic tests. */
  now?: number;
}

/** Build the fixture submissions (sorted newest-first). */
export function buildFixtureSubmissions(options: FixtureOptions = {}): SubmissionDTO[] {
  const count = options.count ?? FIXTURE_SUBMISSION_COUNT;
  const seed = options.seed ?? FIXTURE_SEED;
  const nowMs = options.now ?? Date.now();
  const rng = mulberry32(seed);

  const submissions: SubmissionDTO[] = [];
  for (let i = 0; i < count; i += 1) {
    const statusRoll = rng();
    const status: SubmissionDTO["status"] =
      statusRoll < 0.05 ? "draft" : statusRoll < 0.075 ? "spam" : "completed";

    // Skew towards recent submissions (pow < 1 bunches values near 0).
    const ageHours = Math.pow(rng(), 1.35) * 24 * 30;
    const startedMs = nowMs - ageHours * HOUR_MS;
    const durationMin = 2 + rng() * 7;
    const completedMs = status === "draft" ? null : startedMs + durationMin * MINUTE_MS;

    const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)] ?? "Ada";
    const last = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)] ?? "Lovelace";

    const answers: Record<string, unknown> = {};
    if (status === "spam") {
      answers[FIXTURE_BLOCK_IDS.name] = "asdf";
      if (rng() < 0.5) answers[FIXTURE_BLOCK_IDS.email] = "junk@mailinator.com";
    } else {
      if (rng() < 0.92) answers[FIXTURE_BLOCK_IDS.name] = `${first} ${last}`;
      if (status === "completed" || rng() < 0.5) {
        answers[FIXTURE_BLOCK_IDS.email] = `${first.toLowerCase()}.${last.toLowerCase()}@example.com`;
      }

      const sourceRoll = rng();
      if (sourceRoll < 0.62) answers[FIXTURE_BLOCK_IDS.source] = { optionId: "opt_search" };
      else if (sourceRoll < 0.76) answers[FIXTURE_BLOCK_IDS.source] = { optionId: "opt_referral" };
      else if (sourceRoll < 0.88) answers[FIXTURE_BLOCK_IDS.source] = { optionId: "opt_social" };
      else if (sourceRoll < 0.94) answers[FIXTURE_BLOCK_IDS.source] = { optionId: "opt_podcast" };
      else if (sourceRoll < 0.985) {
        answers[FIXTURE_BLOCK_IDS.source] = {
          other: OTHER_SOURCES[Math.floor(rng() * OTHER_SOURCES.length)] ?? "Word of mouth",
        };
      }

      if (rng() < 0.8) {
        const features = ["opt_forms", "opt_pages", "opt_logic", "opt_exports", "opt_webhooks"];
        const picked = features.filter(() => rng() < 0.34);
        if (picked.length > 0) answers[FIXTURE_BLOCK_IDS.features] = { optionIds: picked };
      }

      if (status === "completed" || rng() < 0.6) {
        const ratingRoll = rng();
        const rating = ratingRoll < 0.06 ? 1 : ratingRoll < 0.17 ? 2 : ratingRoll < 0.38 ? 3 : ratingRoll < 0.72 ? 4 : 5;
        answers[FIXTURE_BLOCK_IDS.setup] = rating;
      }

      if (status === "completed") {
        const npsRoll = rng();
        let nps: number;
        if (npsRoll < 0.24) nps = Math.floor(rng() * 6); // 0–5 detractors
        else if (npsRoll < 0.45) nps = 7 + Math.floor(rng() * 2); // 7–8 passives
        else nps = 9 + Math.floor(rng() * 2); // 9–10 promoters
        answers[FIXTURE_BLOCK_IDS.nps] = nps;
      }

      if (status === "completed" && rng() < 0.55) {
        answers[FIXTURE_BLOCK_IDS.feedback] =
          FEEDBACK[Math.floor(rng() * FEEDBACK.length)] ?? "Great tool.";
      }
    }

    const hidden: Record<string, unknown> = {};
    if (rng() < 0.6) hidden.utm_source = rng() < 0.5 ? "twitter" : "newsletter";
    if (rng() < 0.3) hidden.utm_campaign = "launch-week";

    const variables: Record<string, unknown> = {};
    const npsValue = answers[FIXTURE_BLOCK_IDS.nps];
    if (typeof npsValue === "number") variables.score = npsValue;
    if (rng() < 0.25) variables.planInterest = rng() < 0.5 ? "pro" : "team";

    const tokenHex = Math.floor(rng() * 0xffffffff)
      .toString(16)
      .padStart(8, "0");

    submissions.push({
      id: `sub_fix${String(i).padStart(4, "0")}`,
      documentId: FIXTURE_DOCUMENT.id,
      versionId: "ver_0001",
      status,
      publicToken: `sub_${tokenHex}${String(i).padStart(4, "0")}`,
      answers,
      variables,
      hidden,
      meta: {
        device: DEVICES[Math.floor(rng() * DEVICES.length)] ?? "desktop",
        country: COUNTRIES[Math.floor(rng() * COUNTRIES.length)] ?? "US",
      },
      startedAt: new Date(startedMs).toISOString(),
      completedAt: completedMs === null ? null : new Date(completedMs).toISOString(),
    });
  }

  // Spec §4 — the API returns rows sorted by submitted_at; newest first default.
  return submissions.sort((a, b) => submittedAtOf(b).localeCompare(submittedAtOf(a)));
}

/** submitted_at = completion for finished submissions, else the start time. */
export function submittedAtOf(s: { completedAt: string | null; startedAt: string }): string {
  return s.completedAt ?? s.startedAt;
}
