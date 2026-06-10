import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Kuratiertes Symbol→CoinGecko-Mapping; wird in Meilenstein 2 erweitert (Top ~100).
const ASSETS: Array<{ symbol: string; name: string; coingeckoId: string }> = [
  { symbol: 'BTC', name: 'Bitcoin', coingeckoId: 'bitcoin' },
  { symbol: 'ETH', name: 'Ethereum', coingeckoId: 'ethereum' },
  { symbol: 'SOL', name: 'Solana', coingeckoId: 'solana' },
  { symbol: 'USDT', name: 'Tether', coingeckoId: 'tether' },
  { symbol: 'USDC', name: 'USD Coin', coingeckoId: 'usd-coin' },
  { symbol: 'XRP', name: 'XRP', coingeckoId: 'ripple' },
  { symbol: 'BNB', name: 'BNB', coingeckoId: 'binancecoin' },
  { symbol: 'ADA', name: 'Cardano', coingeckoId: 'cardano' },
  { symbol: 'DOGE', name: 'Dogecoin', coingeckoId: 'dogecoin' },
  { symbol: 'TRX', name: 'TRON', coingeckoId: 'tron' },
  { symbol: 'DOT', name: 'Polkadot', coingeckoId: 'polkadot' },
  { symbol: 'LINK', name: 'Chainlink', coingeckoId: 'chainlink' },
  { symbol: 'MATIC', name: 'Polygon', coingeckoId: 'matic-network' },
  { symbol: 'LTC', name: 'Litecoin', coingeckoId: 'litecoin' },
  { symbol: 'AVAX', name: 'Avalanche', coingeckoId: 'avalanche-2' },
  { symbol: 'XLM', name: 'Stellar', coingeckoId: 'stellar' },
  { symbol: 'ATOM', name: 'Cosmos Hub', coingeckoId: 'cosmos' },
  { symbol: 'UNI', name: 'Uniswap', coingeckoId: 'uniswap' },
  { symbol: 'XMR', name: 'Monero', coingeckoId: 'monero' },
  { symbol: 'ALGO', name: 'Algorand', coingeckoId: 'algorand' },
]

async function main() {
  for (const asset of ASSETS) {
    await prisma.asset.upsert({
      where: { coingeckoId: asset.coingeckoId },
      update: { symbol: asset.symbol, name: asset.name },
      create: asset,
    })
  }
  console.log(`Seed fertig: ${ASSETS.length} Assets.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
