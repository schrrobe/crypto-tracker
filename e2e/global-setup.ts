import { execSync } from 'node:child_process'
import { E2E_DATABASE_URL } from './config'

// Vor jedem Testlauf: E2E-DB anlegen falls fehlend, Migrationen anwenden, Assets seeden.
// Bewusst nicht-destruktiv — Tests erzeugen pro Lauf eigene User und sind dadurch
// unabhängig von Altdaten. Bei Bedarf manuell zurücksetzen:
//   docker exec crypto-tracker-postgres dropdb -U crypto crypto_tracker_e2e
export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL }
  const opts = { env, stdio: 'inherit' as const, cwd: new URL('..', import.meta.url).pathname }

  execSync(
    `docker exec crypto-tracker-postgres psql -U crypto -d postgres -tc ` +
      `"SELECT 1 FROM pg_database WHERE datname='crypto_tracker_e2e'" | grep -q 1 || ` +
      `docker exec crypto-tracker-postgres createdb -U crypto crypto_tracker_e2e`,
    opts,
  )
  execSync('pnpm --filter @crypto-tracker/api exec prisma migrate deploy', opts)
  execSync('pnpm --filter @crypto-tracker/api exec tsx prisma/seed.ts', opts)
}
