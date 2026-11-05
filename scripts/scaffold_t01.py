#!/usr/bin/env python3
"""T01 monorepo scaffold generator — writes the FormForge skeleton into worktrees/t01.

Scope per issue #1: monorepo, tooling, docker-compose, .env.example, CI.
Shared kernel code (Ctx/Result/errors/logger/env) is T02's job — only skeletons here.
"""
import os, json

ROOT = "/home/z/my-project/worktrees/t01"

FILES = {}

# ---------------------------------------------------------------- root
FILES["package.json"] = {
    "name": "formforge",
    "private": True,
    "packageManager": "pnpm@12.16.1",
    "engines": {"node": ">=22"},
    "scripts": {
        "dev": "pnpm -r --parallel dev",
        "build": "pnpm -r build",
        "typecheck": "pnpm -r typecheck",
        "test": "pnpm -r test",
        "lint": "eslint ."
    },
    "devDependencies": {
        "eslint": "^9.39.5",
        "typescript": "^5.9.3",
        "typescript-eslint": "^8.72.1",
        "@types/node": "^24.0.0"
    }
}

FILES["pnpm-workspace.yaml"] = """packages:
  - "apps/*"
  - "packages/*"
"""

FILES["tsconfig.base.json"] = {
    "compilerOptions": {
        "target": "ES2022",
        "lib": ["ES2022"],
        "module": "ESNext",
        "moduleResolution": "bundler",
        "strict": True,
        "noUncheckedIndexedAccess": True,
        "verbatimModuleSyntax": True,
        "isolatedModules": True,
        "esModuleInterop": True,
        "skipLibCheck": True,
        "forceConsistentCasingInFileNames": True,
        "resolveJsonModule": True,
        "noEmit": True
    }
}

FILES["eslint.config.mjs"] = """import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "worktrees/**",
      "tool-results/**",
      "download/**",
      "upload/**",
      "skills/**",
      "agent/**",
      ".agents/**",
    ],
  },
  ...tseslint.configs.recommended,
);
"""

FILES[".gitignore"] = """skills/
node_modules/
.env
.env.*
upload/
worktrees/
tool-results/
download/
.next/
out/
dist/
coverage/
*.tsbuildinfo
*.log
.DS_Store
next-env.d.ts
"""

FILES[".env.example"] = """# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
PUBLIC_BASE_URL=http://localhost:3000        # used for share links
SESSION_SECRET=
# Database / cache
DATABASE_URL=postgres://postgres:postgres@localhost:5432/formforge
REDIS_URL=redis://localhost:6379
# Auth
AUTH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Storage
S3_ENDPOINT=http://localhost:9000
S3_REGION=auto
S3_BUCKET=formforge
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_PUBLIC_CDN_URL=http://localhost:9000/formforge
# Email
RESEND_API_KEY=
EMAIL_FROM="FormForge <no-reply@example.com>"
# Billing
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO=
STRIPE_PRICE_BUSINESS=
# Abuse
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
# AI (Phase M8)
ANTHROPIC_API_KEY=
AI_MODEL=claude-sonnet-4-6
# Edge / domains (Phase 2)
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ZONE_ID=
"""

FILES["docker-compose.yml"] = """# Local dev environment (spec §2). Postgres 16 + Redis 7 + MinIO (S3).
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: formforge
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d formforge"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - miniodata:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
  redisdata:
  miniodata:
"""

FILES[".github/workflows/ci.yml"] = """name: CI

on:
  push:
    branches: ["**"]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: formforge
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/formforge
      REDIS_URL: redis://localhost:6379
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Unit tests
        run: pnpm test

      - name: Build
        run: pnpm build

      # T02 (issue #2) appends: drizzle-kit generate/migrate against the CI postgres here.
"""

FILES["README.md"] = """# FormForge

Multi-tenant SaaS for **forms, landing pages and portfolios** on one block-document model.
The build spec is the source of truth: [`spec.md`](./spec.md).

## Quickstart (local)

```bash
docker compose up -d          # postgres 16 + redis 7 + minio
cp .env.example .env          # fill secrets as needed
pnpm install
pnpm dev                      # web (Next.js, :3000) + worker (BullMQ) in parallel
```

## Repository layout

See spec §2. In short: `apps/web` (Next.js 15 App Router), `apps/worker` (BullMQ),
`packages/{core,schema,db,blocks,renderer,ui,config}`.

## Agent workflow

- Tickets live as GitHub issues #1–#29 with blocking edges (see [`docs/tickets.md`](./docs/tickets.md)).
- Implementation happens one ticket per git worktree + branch `ticket/<nn>-<slug>`.
- `main` is the integration branch: merges are done by the lead session only.
"""

# ---------------------------------------------------------------- apps/web
FILES["apps/web/package.json"] = {
    "name": "@formforge/web",
    "private": True,
    "type": "module",
    "scripts": {
        "dev": "next dev -p 3000",
        "build": "next build",
        "start": "next start -p 3000",
        "typecheck": "tsc --noEmit",
        "test": "vitest run --passWithNoTests",
        "lint": "eslint ."
    },
    "dependencies": {
        "next": "^15.5.29",
        "react": "^19.3.1",
        "react-dom": "^19.3.1"
    },
    "devDependencies": {
        "typescript": "^5.9.3",
        "vitest": "^5.1.0",
        "@types/node": "^24.0.0",
        "@types/react": "^19.3.0",
        "@types/react-dom": "^19.3.0",
        "tailwindcss": "^4.3.4",
        "@tailwindcss/postcss": "^4.3.4"
    }
}

FILES["apps/web/next.config.ts"] = """import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
};

export default config;
"""

FILES["apps/web/tsconfig.json"] = {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
        "plugins": [{"name": "next"}],
        "lib": ["dom", "dom.iterable", "ES2022"],
        "jsx": "preserve",
        "module": "esnext",
        "incremental": True,
        "types": ["node"]
    },
    "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    "exclude": ["node_modules"]
}

FILES["apps/web/postcss.config.mjs"] = """export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
"""

FILES["apps/web/app/globals.css"] = """@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #0f172a;
}

body {
  background: var(--background);
  color: var(--foreground);
}
"""

FILES["apps/web/app/layout.tsx"] = """import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "FormForge",
  description: "Forms, landing pages and portfolios — one block-document model.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
"""

FILES["apps/web/app/page.tsx"] = """export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-5xl font-bold tracking-tight">FormForge</h1>
      <p className="max-w-xl text-lg text-slate-600">
        Forms, landing pages and portfolios — one block-document model.
      </p>
      <p className="text-sm text-slate-400">
        Scaffold (T01). Auth lands with T03, builder with T08.
      </p>
    </main>
  );
}
"""

# ---------------------------------------------------------------- apps/worker
FILES["apps/worker/package.json"] = {
    "name": "@formforge/worker",
    "private": True,
    "type": "module",
    "scripts": {
        "dev": "tsx watch src/index.ts",
        "build": "tsc --noEmit",
        "typecheck": "tsc --noEmit",
        "test": "vitest run --passWithNoTests"
    },
    "dependencies": {
        "bullmq": "^6.7.0",
        "ioredis": "^5.11.1"
    },
    "devDependencies": {
        "typescript": "^5.9.3",
        "tsx": "^4.23.15",
        "vitest": "^5.1.0",
        "@types/node": "^24.0.0"
    }
}

FILES["apps/worker/tsconfig.json"] = {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {"types": ["node"]},
    "include": ["src"]
}

FILES["apps/worker/src/index.ts"] = """// FormForge worker entrypoint (T01 scaffold).
// SPEC-NOTE: T17 (issue #17) owns the real queue topology (events fan-out,
// webhooks, email, rollups, exports). This skeleton only proves the dev loop:
// `docker compose up -d && pnpm dev` runs web + worker together.
import { Worker } from "bullmq";
import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

const worker = new Worker(
  "jobs",
  async (job) => {
    console.log(
      JSON.stringify({ level: "info", msg: "job processed", id: job.id, name: job.name }),
    );
  },
  { connection },
);

async function shutdown(signal: string): Promise<void> {
  console.log(JSON.stringify({ level: "info", msg: "worker shutting down", signal }));
  await worker.close();
  connection.disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log(
  JSON.stringify({ level: "info", msg: "worker started", queue: "jobs", redis: redisUrl }),
);
"""

# ---------------------------------------------------------------- packages
def pkg(name: str, deps: dict, devdeps_extra: dict | None = None) -> dict:
    d = {
        "name": name,
        "private": True,
        "type": "module",
        "exports": {".": "./src/index.ts"},
        "scripts": {
            "build": "tsc --noEmit",
            "typecheck": "tsc --noEmit",
            "test": "vitest run --passWithNoTests"
        },
        "dependencies": deps,
        "devDependencies": {
            "typescript": "^5.9.3",
            "vitest": "^5.1.0",
            **(devdeps_extra or {}),
        },
    }
    return d

BASE_PKG_TS = {
    "extends": "../../tsconfig.base.json",
    "include": ["src"]
}

FILES["packages/core/package.json"] = pkg("@formforge/core", {"zod": "^4.6.7"})
FILES["packages/core/tsconfig.json"] = BASE_PKG_TS
FILES["packages/core/src/index.ts"] = """// @formforge/core — domain modules (spec §2/§3).
// OWNED BY T02 (issue #2): shared kernel (Ctx, Result, AppError, ids, logger, env)
// lands in src/shared/. Later tickets add their own module folders
// (identity/, documents/, logic/, submissions/, ...).
export {};
"""

FILES["packages/schema/package.json"] = pkg("@formforge/schema", {"zod": "^4.6.7"})
FILES["packages/schema/tsconfig.json"] = BASE_PKG_TS
FILES["packages/schema/src/index.ts"] = """// @formforge/schema — Zod schemas: blocks, documents, rules, api (spec §7).
// OWNED BY T06 (issue #6). T25 adds src/api/ as new files only.
export {};
"""

FILES["packages/db/package.json"] = pkg(
    "@formforge/db",
    {"drizzle-orm": "^0.45.4", "pg": "^8.23.1"},
    {"drizzle-kit": "^0.31.11", "@types/pg": "^8.15.0"},
)
FILES["packages/db/tsconfig.json"] = BASE_PKG_TS
FILES["packages/db/src/index.ts"] = """// @formforge/db — drizzle schema, migrations, repositories (spec §2/§6).
// OWNED BY T02 (issue #2): drizzle.config.ts, src/schema/** (identity first),
// migration pipeline, seed script. Later tickets add NEW files under
// src/repositories/** — they must not touch src/schema/**.
export {};
"""

FILES["packages/blocks/package.json"] = pkg(
    "@formforge/blocks",
    {"zod": "^4.6.7", "@formforge/schema": "workspace:*"},
)
FILES["packages/blocks/tsconfig.json"] = BASE_PKG_TS
FILES["packages/blocks/src/index.ts"] = """// @formforge/blocks — block definitions: schema + editor + renderer per kind (spec §2).
// OWNED BY T06 (issue #6): registry + hero, short-text, button first; T09/T21 add more.
export {};
"""

FILES["packages/renderer/package.json"] = pkg(
    "@formforge/renderer",
    {"react": "^19.3.1", "react-dom": "^19.3.1", "@formforge/blocks": "workspace:*"},
    {"@types/react": "^19.3.0", "@types/react-dom": "^19.3.0"},
)
FILES["packages/renderer/tsconfig.json"] = {
    **BASE_PKG_TS,
    "compilerOptions": {"lib": ["ES2022", "dom", "dom.iterable"], "jsx": "react-jsx"},
}
FILES["packages/renderer/src/index.ts"] = """// @formforge/renderer — public renderer bundles (spec §2).
// T11 (issue #11) owns src/scroll/, T12 (issue #12) owns src/conversational/.
export {};
"""

FILES["packages/ui/package.json"] = pkg(
    "@formforge/ui",
    {"react": "^19.3.1"},
    {"@types/react": "^19.3.0"},
)
FILES["packages/ui/tsconfig.json"] = {
    **BASE_PKG_TS,
    "compilerOptions": {"lib": ["ES2022", "dom", "dom.iterable"], "jsx": "react-jsx"},
}
FILES["packages/ui/src/index.ts"] = """// @formforge/ui — shared UI primitives (spec §2).
// First used by T03 (dashboard shell) and T08 (builder). shadcn/ui on Tailwind 4.
export {};
"""

FILES["packages/config/package.json"] = {
    "name": "@formforge/config",
    "private": True,
    "type": "module"
}
FILES["packages/config/README.md"] = """# @formforge/config

Shared tsconfig / eslint presets (spec §2). Currently the base tsconfig lives at the
repo root (`tsconfig.base.json`); promote shared presets here when duplication appears.
"""

def main() -> None:
    count = 0
    for rel, content in FILES.items():
        path = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if isinstance(content, (dict, list)):
            with open(path, "w") as f:
                json.dump(content, f, indent=2)
                f.write("\n")
        else:
            with open(path, "w") as f:
                f.write(content)
        count += 1
    print(f"wrote {count} files under {ROOT}")

if __name__ == "__main__":
    main()
