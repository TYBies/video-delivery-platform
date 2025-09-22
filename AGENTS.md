# Repository Guidelines

## Project Structure & Module Organization
- `app/`: Next.js App Router. API routes in `app/api/*/route.ts`; pages under `app/**/page.tsx`.
- `lib/`: Core services and utilities (e.g., `upload-state-manager.ts`, `r2-storage.ts`, `env-config.ts`).
- `__tests__/`: Jest tests mirroring module names (e.g., `upload-state-manager.test.ts`).
- `scripts/`: Operational tasks (e.g., `startup.ts`, `recover-orphans.ts`). Run with `npx tsx <script>`.
- `types/`: Shared TypeScript types.
- `uploads/`: Local dev storage (metadata, temp, state). Do not store real data.
- `.kiro/specs/`: Internal design docs/specs.

## Build, Test, and Development Commands
- `npm run dev`: Start Next.js dev server at `http://localhost:3000`.
- `npm run build`: Build the production bundle.
- `npm start`: Run the built app.
- `npm run lint`: Lint using Next.js ESLint config.
- `npm test`: Run Jest tests. Example: `npm test -- upload-state-manager`.
- Scripts: `npx tsx scripts/startup.ts`, `npx tsx scripts/recover-orphans.ts` (ensure `tsx` is available).

## Coding Style & Naming Conventions
- TypeScript (strict mode). Prefer 2-space indentation.
- Files: kebab-case (e.g., `r2-client.ts`). Types/components: PascalCase. Variables/functions: camelCase.
- Use path alias `@/` for repo-root imports (see `tsconfig.json`).
- Keep modules focused; colocate helpers in `lib/`. Run `npm run lint` before submitting.

## Testing Guidelines
- Framework: Jest + `next/jest`. Tests live in `__tests__/*.test.ts`.
- Mirror module names (e.g., `lib/storage.ts` → `__tests__/storage.test.ts`).
- Test critical flows: chunked uploads, R2 fallback, orphan recovery.
- Run all tests with `npm test`; target a file via `npm test -- <pattern>`.

## Commit & Pull Request Guidelines
- Commits: Follow Conventional Commits (e.g., `feat:`, `fix:`, `chore:`). Keep scope small.
- PRs: Include summary, linked issue, test plan/coverage notes, and screenshots for UI changes.
- Ensure CI basics pass locally: `npm run lint` and `npm test`.

## Security & Configuration Tips
- Copy `.env.local.example` → `.env.local`. For production, set R2 and secrets (see `lib/env-config.ts`).
- Never commit secrets or real uploads. `.env.local` is ignored.
- Without R2, local dev works but backups are disabled; see warnings in startup logs.
