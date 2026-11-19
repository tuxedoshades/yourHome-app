# YourHome Architecture (v0)

## Monorepo layout
- `apps/api`: Fastify API + Prisma + PostgreSQL
- `apps/mobile`: Mobile app placeholder
- `apps/reviewer-web`: Reviewer dashboard placeholder
- `packages/shared`: Shared TS types and utilities
- `infra/docker-compose.yml`: Local Postgres

## Initial flow
1. API serves `/health`
2. Prisma manages core domain models
3. Postgres is the source of truth
4. Reviewer/mobile apps will consume API in later sprints
