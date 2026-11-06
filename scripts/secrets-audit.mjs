#!/usr/bin/env node
// T29 (spec §17) — secrets audit: "Secrets only in env/secret manager; no
// secrets in logs or client bundles."
//
// Static checks (no build required; CI runs this on every PR):
//   A. Secret-bearing env vars are read via process.env ONLY in server-side
//      files — never in files that are part of the client graph ("use client"
//      components, packages/{renderer,blocks,ui} shared to the browser).
//   B. No committed file contains a high-entropy literal that LOOKS like a
//      secret (sk_/whsec_/AKIA prefixes, base64/hex blobs ≥ 32 chars) outside
//      .env.example placeholders and tests that need dummy secrets.
//   C. Loggers never serialize the secret-bearing env names (grep log call
//      sites for those identifiers).
//   D. When a built Next.js bundle exists (apps/web/.next), scan it for the
//      env NAMES of secret vars — their presence means a secret leaked into
//      the client graph at build time.
//
// Exit 1 on any finding (CI gate); exit 0 prints the evidence summary.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = process.cwd();
const findings = [];

// --- Configuration ------------------------------------------------------------

/** env var names that carry credentials (spec §5 + .env.example T29 block). */
const SECRET_ENV_NAMES = [
  "SESSION_SECRET", "AUTH_SECRET", "GOOGLE_CLIENT_SECRET", "S3_SECRET_ACCESS_KEY",
  "RESEND_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "TURNSTILE_SECRET_KEY", "ANTHROPIC_API_KEY", "CLOUDFLARE_API_TOKEN",
  "ADMIN_API_KEY",
];

/** Source roots that may legitimately read secret env (server planes). */
const SERVER_ROOTS = [
  "apps/web/app/api/", "apps/web/lib/", "apps/web/auth.config.ts", "apps/web/middleware.ts",
  "apps/worker/", "packages/core/src/", "packages/db/src/", "packages/mcp/src/", "scripts/",
];

/** Client-side source roots — secret env here is ALWAYS a finding (check A). */
const CLIENT_ROOTS = [
  "packages/renderer/src/", "packages/blocks/src/", "packages/ui/src/",
  "apps/web/components/", "apps/web/app/embed/",
];

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const IGNORED_DIRS = new Set([
  "node_modules", ".next", ".git", "dist", "build", "coverage", ".turbo",
  "pnpm-lock.yaml", "pnpm-workspace.yaml",
]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const rel = relative(ROOT, full);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (SOURCE_EXTS.has(extname(entry))) yield { full, rel };
  }
}

// --- Check A: secret env reads must live on the server -------------------------

for (const { rel } of walk(ROOT)) {
  const isClientRoot = CLIENT_ROOTS.some((r) => rel.startsWith(r));
  if (!isClientRoot) continue;
  const text = readFileSync(join(ROOT, rel), "utf8");
  for (const name of SECRET_ENV_NAMES) {
    const pattern = new RegExp(`process\\.env\\[['"\\]${name}['"\\]]|process\\.env\\.${name}\\b`);
    if (pattern.test(text)) {
      findings.push(`A: client-side file ${rel} reads secret env ${name}`);
    }
  }
}

// --- Check B: secret-shaped literals in the repo -------------------------------

const SECRET_SHAPED = [
  /sk-(?:live|test)-[A-Za-z0-9]{20,}/, // stripe-style secret keys
  /whsec_[A-Za-z0-9]{20,}/, // stripe webhook secrets
  /AKIA[0-9A-Z]{16}/, // AWS access key ids
  /ff_(?:live|test)?[A-Za-z0-9]{30,}/, // formforge plaintext API-token format (only ever shown once — never stored)
];

const HIGH_ENTROPY = /["'=:]\s*["']([A-Za-z0-9+/=_-]{40,})["']/; // long opaque literal in a string

const ALLOWED_SECRET_SHAPES = [
  /(^|\/)(\.env\.example)$/, // placeholders only (empty values)
  /secrets-audit\.mjs$/, // this file's own patterns
  /__tests__|\.test\.|\.spec\./, // tests may carry dummy secrets
  /fixtures?\.ts$/,
];

for (const { rel } of walk(ROOT)) {
  if (ALLOWED_SECRET_SHAPES.some((r) => r.test(rel))) continue;
  const text = readFileSync(join(ROOT, rel), "utf8");
  for (const re of SECRET_SHAPED) {
    const m = re.exec(text);
    if (m) findings.push(`B: ${rel} contains a secret-shaped literal (${m[0].slice(0, 12)}…)`);
  }
  // High-entropy strings: flag only in non-test source (tests excluded above).
  const entropyMatch = HIGH_ENTROPY.exec(text);
  if (entropyMatch) {
    const value = entropyMatch[1];
    const looksRandom = /(?=(.*[A-Za-z]){8})(?=(.*[0-9]){4})/.test(value);
    // Character-set constants (BASE58/URL-safe alphabets for id generation)
    // are long but NOT random draws — they contain (nearly) every letter.
    const distinctLowercase = new Set(value.toLowerCase().match(/[a-z]/g) ?? []).size;
    const isAlphabetConstant = distinctLowercase >= 24;
    if (looksRandom && !isAlphabetConstant) {
      findings.push(`B: ${rel} contains a high-entropy literal (len ${value.length}) — move it to env`);
    }
  }
}

// --- Check C: log call sites must not serialize secret identifiers --------------

for (const { rel } of walk(ROOT)) {
  if (!SERVER_ROOTS.some((r) => rel.startsWith(r))) continue;
  const text = readFileSync(join(ROOT, rel), "utf8");
  const logCall = /\.(?:info|warn|error|debug|log)\s*\(/g;
  let m;
  while ((m = logCall.exec(text)) !== null) {
    // Take a slice after the call start; crude but effective for the obvious
    // `logger.info("…", { secret: X })` shapes.
    const tail = text.slice(m.index, m.index + 400);
    for (const name of SECRET_ENV_NAMES) {
      const re = new RegExp(`${name}\\s*[:)]|[\"']${name}[\"']`, "g");
      if (re.test(tail)) {
        findings.push(`C: ${rel} logging call may serialize secret env ${name} (offset ${m.index})`);
      }
    }
  }
}

// --- Check D: built bundles (only when a .next build exists) --------------------

const nextDir = join(ROOT, "apps/web/.next");
if (existsSync(nextDir)) {
  // Only the CLIENT graph (.next/static) — server chunks legitimately read
  // process.env.* by name; a name there is not a leak. A secret env read that
  // actually ships to browsers lands in .next/static (webpack inlines it).
  for (const { rel } of walk(nextDir)) {
    if (!/^apps\/web\/\.next\/static\//.test(rel)) continue;
    if (!/\.(?:js|html|mjs)$/.test(rel)) continue;
    const text = readFileSync(join(ROOT, rel), "utf8");
    for (const name of SECRET_ENV_NAMES) {
      if (text.includes(name)) {
        findings.push(`D: built bundle ${rel} references secret env ${name} — a secret leaked into the client graph`);
      }
    }
  }
} else {
  console.log("[secrets-audit] apps/web/.next not built — check D (bundle scan) SKIPPED; CI runs it after `next build`.");
}

// --- Report ---------------------------------------------------------------------

if (findings.length > 0) {
  console.error(`[secrets-audit] FAILED — ${findings.length} finding(s):`);
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("[secrets-audit] OK — no secrets in client graphs, logs, or committed literals.");
console.log(`  checked env names: ${SECRET_ENV_NAMES.join(", ")}`);
