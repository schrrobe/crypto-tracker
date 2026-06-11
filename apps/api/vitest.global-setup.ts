import { execSync } from 'node:child_process'

// Test-DB anlegen (falls fehlend), Migrationen anwenden, Assets seeden.
// Bewusst nicht-destruktiv — Tests erzeugen eigene User und sind dadurch
// unabhängig von Altdaten (gleiche Strategie wie bei den Playwright-E2E-Tests).
const TEST_DATABASE_URL = 'postgresql://crypto:crypto@localhost:5434/crypto_tracker_test?schema=public'

export default function globalSetup() {
  const cwd = new URL('.', import.meta.url).pathname
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL }

  execSync(
    `docker exec crypto-tracker-postgres psql -U crypto -d postgres -tc ` +
      `"SELECT 1 FROM pg_database WHERE datname='crypto_tracker_test'" | grep -q 1 || ` +
      `docker exec crypto-tracker-postgres createdb -U crypto crypto_tracker_test`,
    { stdio: 'inherit' },
  )
  execSync('pnpm exec prisma migrate deploy', { env, stdio: 'inherit', cwd })
  execSync('pnpm exec tsx prisma/seed.ts', { env, stdio: 'inherit', cwd })
}
