# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**PPE (Punto de Pago Electrónico)** is a NestJS backend for unattended cash payment collection at parking facilities. It runs on a dedicated machine, separate from the central server (`nexo_back`), and communicates with it over a local network via Socket.io. The PPE handles cash receipt, change dispensing, local auditing, and synchronization with `nexo_back`, which remains the authority on whether a payment is confirmed and a vehicle can exit.

## Commands

```bash
# Development
npm run start:dev          # Watch mode
npm run build              # TypeScript compile + path alias resolution
npm run start:prod         # Run compiled output (out/main)

# Code quality
npm run lint               # ESLint with auto-fix
npm run format             # Prettier

# Testing
npm test -- --runInBand    # Unit tests (must use --runInBand for SQLite)
npm run test:e2e -- --runInBand  # E2E tests
npm run test:cov           # Coverage report

# Database migrations
npm run migration:generate  # Auto-generate from entity changes
npm run migration:run       # Apply pending migrations
npm run migration:revert    # Revert last migration
```

> Never use TypeORM `synchronize: true`. All schema changes must go through migrations.

## Architecture

The app follows a layered DDD pattern inside each NestJS module:

```
src/modules/<module>/
  domain/           # Business logic — no framework/infra dependencies
    errors/         # Semantic domain errors (extend DomainError from common/)
    ports/          # Interface contracts for external dependencies
  application/      # Use case orchestration
  infrastructure/   # TypeORM repos, socket clients, hardware adapters
  interfaces/       # Controllers and DTOs
src/common/
  errors/           # DomainError base class + DomainExceptionFilter (global)
  config/           # All env reads are centralised here — never read process.env elsewhere
  security/         # Role-based API key guard
```

**Core modules:**

| Module | Responsibility |
|---|---|
| `payment-core` | Payment session state machine; orchestrates the full cash collection flow |
| `cash-management` | Denomination inventory, change calculation, cash load/unload |
| `peripherals` | Hardware adapters for bill validators and electronic boards |
| `server-link` | Socket.io client to `nexo_back`; encapsulates all server communication |
| `audit` | Event logging for sessions, devices, and sync attempts |
| `persistence` | TypeORM + SQLite configuration and migrations |
| `local-api` | REST endpoints with role-based API key auth |
| `common` | Config, guards, shared errors |

**Payment flow:** QR/plate scan → create local session (`ppeTransactionUuid`) → validate with server → accept cash (bills/coins by denomination) → calculate change → dispense change → commit to `nexo_back` → audit trail.

**Key identity relationship:** Every payment session maintains `ppeTransactionUuid` (local UUID), `serverPaymentId` (numeric from `nexo_back`), `qrCode`, and `processId`.

## Critical Rules

### Money and types
- Money is always stored and calculated as **integers in COP cents** — never `float`.
- Denominations come from the `denominations` DB table, never hardcoded constants.
- Active denominations: 50, 100, 200, 500, 1,000, 2,000, 5,000, 10,000, 20,000, 50,000 COP (100,000 excluded).
- No `any` — use `unknown` for genuinely uncertain types.
- All external payloads (socket, HTTP) must be mapped to typed internal models before reaching the domain.
- States (session, sync, device) must be `enum` or literal unions, not magic strings.

### Layering
- Domain classes must not import from NestJS, TypeORM, or any infrastructure library.
- TypeORM entities are not domain objects — map between them explicitly.
- `server-link` is the only module allowed to emit socket events or build server payloads.
- Controllers only validate DTOs, call application services, and adapt responses.
- Read `process.env` only inside the centralized config module (`src/common/config/`).

### Errors
- Use semantic, named errors per use case: `PaymentSessionNotFoundError`, `InsufficientChangeError`, `DeviceUnavailableError`, `ServerCommitRejectedError`.
- Domain throws domain errors. Controllers translate to HTTP exceptions.

### Hardware
- All peripherals are accessed through stable port interfaces (`BillAcceptorPort`, `ChangeDispenserPort`, etc.).
- Legacy implementations live in `infrastructure/` and are injected — the domain never imports hardware libraries directly.

## Environment Variables

See `.env.example` for the full list. Key variables:

```env
PORT=3000
DATABASE_PATH=./data/ppe.sqlite
SERVER_LINK_URL=http://localhost:3001
PPE_DEVICE_UUID=...
PPE_DEVICE_SECRET=...
LOCAL_API_ADMIN_KEY=...
LOCAL_API_OPERATOR_KEY=...
LOCAL_API_AUDIT_KEY=...
```

## Local API Authentication

All endpoints require an `x-api-key` header with role-based access:
- `admin` — full access
- `operator` — operational actions
- `audit` — read-only audit queries

Public endpoints (no key required): `GET /api/health/live`, `GET /api/health/ready`.
