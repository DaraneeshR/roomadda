# RoomAdda

PG-accommodation platform for India. This repository is a pnpm + Turborepo
monorepo. The Flutter mobile app lives in `mobile/` and is **not** part of the
JS workspace — it has its own toolchain.

## Layout

```
roomadda/
├─ backend/          Node 20 + Fastify 5 + Prisma 6 + PostgreSQL/PostGIS
├─ webadmin/         React + Vite + TypeScript
├─ website/          Next.js (App Router) + TypeScript
├─ mobile/           Flutter (standalone — separate pubspec/toolchain)
└─ packages/
   └─ shared/        Shared TypeScript types + zod schemas (@roomadda/shared)
```

## Prerequisites

- Node 20 LTS (`nvm use` reads `.nvmrc`)
- pnpm 9+ (via Corepack: `corepack enable`)
- Docker + Docker Compose

## Getting started

```bash
corepack enable                 # makes pnpm available
pnpm install                    # install all JS workspaces
cp .env.example .env            # root env for docker compose
docker compose up -d            # start postgis (db) + redis

# per-app env
cp backend/.env.example backend/.env
cp webadmin/.env.example webadmin/.env
cp website/.env.example website/.env
```

## Common tasks (run from the repo root)

```bash
pnpm build        # turbo run build
pnpm lint         # turbo run lint
pnpm typecheck    # turbo run typecheck
pnpm test         # turbo run test
pnpm dev          # turbo run dev (persistent)
```

Turborepo caches task outputs and respects the dependency graph
(`dependsOn: ["^build"]`), so a package is only rebuilt when its inputs change.

## Notes

- `@prisma/client` build scripts are not auto-run on install (no models yet).
  Once `backend/prisma/schema.prisma` has models, run
  `pnpm --filter @roomadda/backend prisma:generate`.
- Only `*.env.example` files are committed. Never commit a real `.env`.
- The mobile app: `cd mobile && flutter pub get && flutter run`.
