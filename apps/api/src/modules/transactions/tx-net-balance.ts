import { Prisma, type TxType } from '@prisma/client'

export interface NetBalanceTx {
  assetId: string
  type: TxType
  quantity: Prisma.Decimal
  // Fee paid for this transaction (absolute amount). Only subtracted from the
  // balance when `feeInAsset` is true, i.e. the fee is denominated in the row's
  // own asset (Kraken ledgers) rather than fiat.
  fee?: Prisma.Decimal | null
  feeInAsset?: boolean
}

export interface NetBalanceResult {
  holdings: Array<{ assetId: string; quantity: Prisma.Decimal }>
  // Assets that had balance-affecting activity but netted to <= 0 (more sells
  // than buys → likely incomplete history). Dropped from holdings; surfaced so
  // callers can warn instead of silently losing the asset.
  nonPositiveAssetIds: string[]
}

// Condenses transactions into net balances: BUY/DEPOSIT/STAKING_REWARD count
// positive, SELL/WITHDRAWAL negative, TRANSFER/OTHER neutral. Asset-denominated
// fees are always subtracted (a fee leaves the account regardless of tx type).
// Only positive balances become holdings. Shared logic for CSV imports and
// manual transactions. No PnL/cost-basis calculation in V1.
export function computeNetBalances(txs: NetBalanceTx[]): NetBalanceResult {
  const ZERO = new Prisma.Decimal(0)
  const net = new Map<string, Prisma.Decimal>()
  for (const tx of txs) {
    const sign =
      tx.type === 'BUY' || tx.type === 'DEPOSIT' || tx.type === 'STAKING_REWARD'
        ? 1
        : tx.type === 'SELL' || tx.type === 'WITHDRAWAL'
          ? -1
          : 0
    let delta = tx.quantity.mul(sign)
    if (tx.feeInAsset && tx.fee) delta = delta.sub(tx.fee)
    if (delta.isZero()) continue
    net.set(tx.assetId, (net.get(tx.assetId) ?? ZERO).add(delta))
  }

  const holdings: NetBalanceResult['holdings'] = []
  const nonPositiveAssetIds: string[] = []
  for (const [assetId, quantity] of net.entries()) {
    if (quantity.gt(0)) holdings.push({ assetId, quantity })
    else nonPositiveAssetIds.push(assetId)
  }
  return { holdings, nonPositiveAssetIds }
}
