#!/usr/bin/env node
// Rotates the Neon role password (voids any prior exposure) and stores fresh
// pooled/direct DSNs locally. NEVER prints credentials — output is masked.
import { readFileSync, writeFileSync, chmodSync } from "node:fs";

const API = "https://console.neon.tech/api/v2";
const ORG = process.env.NEON_ORG_ID;
const PID = process.env.NEON_PROJECT_ID;
const BID = process.env.NEON_BRANCH_ID;
const ROLE = process.env.NEON_ROLE;
const NT = readFileSync("scripts/.neon-token", "utf8").trim();
const H = { Authorization: `Bearer ${NT}`, "Content-Type": "application/json" };

async function j(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const t = await r.text();
  let d;
  try { d = JSON.parse(t); } catch { d = { raw: t.slice(0, 200) }; }
  if (!r.ok) {
    console.error("HTTP", r.status, url.replace(API, ""), JSON.stringify(d).slice(0, 200));
    process.exit(1);
  }
  return d;
}

const q = `org_id=${ORG}`;

// 1. Rotate the role password (voids any previously exposed copy)
const rr = await j(`${API}/projects/${PID}/branches/${BID}/roles/${ROLE}/reset_password?${q}`, {
  method: "POST",
  body: JSON.stringify({}),
});
const pw = rr?.role?.password;
if (!pw) { console.error("reset response had no password"); process.exit(1); }
console.log("password rotated: yes (new password length", String(pw.length) + ")");

// 2. Fetch canonical pooled URI (contains the new password)
const u = await j(`${API}/projects/${PID}/connection_uri?${q}&pooled=true&database_name=neondb&role_name=${ROLE}`);
const pooled = u.uri;
if (!pooled || !/^postgres(ql)?:\/\//.test(pooled)) { console.error("no pooled uri returned"); process.exit(1); }

// 3. Derive direct (unpooled) DSN by removing the -pooler suffix from the host
const direct = pooled.replace("-pooler.", ".");
if (direct === pooled) { console.error("could not derive direct host"); process.exit(1); }

writeFileSync("scripts/.neon-db-url", pooled, { mode: 0o600 });
writeFileSync("scripts/.neon-db-url-direct", direct, { mode: 0o600 });
chmodSync("scripts/.neon-db-url", 0o600);
chmodSync("scripts/.neon-db-url-direct", 0o600);

const hostOf = (s) => s.replace(/^postgres(ql)?:\/\/[^@]*@/, "").split("/")[0];
const masked = (s) => s.replace(/^postgres(ql)?:\/\/[^:@\/]+:[^@]+@/, "$1:***@");
console.log("pooled DSN stored:  scripts/.neon-db-url        ", masked(pooled));
console.log("direct DSN stored:  scripts/.neon-db-url-direct ", masked(direct));
console.log("pooled host:", hostOf(pooled));
console.log("direct host:", hostOf(direct));
