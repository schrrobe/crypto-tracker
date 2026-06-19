// Grant (or revoke) admin rights by email.
// Usage: tsx scripts/grant-admin.ts <email> [--revoke]
import { prisma } from '../src/lib/prisma'

async function main() {
  const email = process.argv[2]?.toLowerCase().trim()
  const revoke = process.argv.includes('--revoke')
  if (!email) {
    console.error('Usage: tsx scripts/grant-admin.ts <email> [--revoke]')
    process.exit(1)
  }
  const user = await prisma.user.update({
    where: { email },
    data: { isAdmin: !revoke },
  }).catch(() => null)
  if (!user) {
    console.error(`Kein User mit E-Mail ${email}`)
    process.exit(1)
  }
  console.log(`${user.email}: isAdmin=${user.isAdmin}`)
  await prisma.$disconnect()
}

void main()
