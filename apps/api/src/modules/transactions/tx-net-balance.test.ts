import { Prisma, type TxType } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { computeNetBalances, type NetBalanceTx } from './tx-net-balance'

const d = (n: string | number) => new Prisma.Decimal(n)
const tx = (type: TxType, quantity: string, extra: Partial<NetBalanceTx> = {}): NetBalanceTx => ({
  assetId: 'btc',
  type,
  quantity: d(quantity),
  ...extra,
})

describe('computeNetBalances', () => {
  it('zählt BUY/DEPOSIT/STAKING_REWARD positiv', () => {
    const { holdings } = computeNetBalances([
      tx('BUY', '1'),
      tx('DEPOSIT', '2'),
      tx('STAKING_REWARD', '0.5'),
    ])
    expect(holdings).toEqual([{ assetId: 'btc', quantity: d('3.5') }])
  })

  it('zählt SELL/WITHDRAWAL negativ', () => {
    const { holdings } = computeNetBalances([tx('BUY', '5'), tx('SELL', '1'), tx('WITHDRAWAL', '2')])
    expect(holdings).toEqual([{ assetId: 'btc', quantity: d('2') }])
  })

  it('behandelt TRANSFER/OTHER neutral', () => {
    const { holdings } = computeNetBalances([tx('BUY', '1'), tx('TRANSFER', '10'), tx('OTHER', '5')])
    expect(holdings).toEqual([{ assetId: 'btc', quantity: d('1') }])
  })

  it('akkumuliert pro Asset getrennt', () => {
    const { holdings } = computeNetBalances([
      tx('BUY', '1', { assetId: 'btc' }),
      tx('BUY', '3', { assetId: 'eth' }),
      tx('SELL', '1', { assetId: 'eth' }),
    ])
    expect(holdings).toEqual([
      { assetId: 'btc', quantity: d('1') },
      { assetId: 'eth', quantity: d('2') },
    ])
  })

  it('zieht assetdenominierte Gebühren ab', () => {
    const { holdings } = computeNetBalances([tx('BUY', '1', { fee: d('0.01'), feeInAsset: true })])
    expect(holdings).toEqual([{ assetId: 'btc', quantity: d('0.99') }])
  })

  it('ignoriert Fiat-Gebühren (feeInAsset=false)', () => {
    const { holdings } = computeNetBalances([tx('BUY', '1', { fee: d('5'), feeInAsset: false })])
    expect(holdings).toEqual([{ assetId: 'btc', quantity: d('1') }])
  })

  it('zieht Gebühr auch bei neutralem Typ ab (Fee verlässt das Konto)', () => {
    const { holdings, nonPositiveAssetIds } = computeNetBalances([
      tx('BUY', '1'),
      tx('TRANSFER', '0', { fee: d('0.1'), feeInAsset: true }),
    ])
    expect(holdings).toEqual([{ assetId: 'btc', quantity: d('0.9') }])
    expect(nonPositiveAssetIds).toEqual([])
  })

  it('meldet Assets mit Nettobestand <= 0 statt sie still zu verlieren', () => {
    const { holdings, nonPositiveAssetIds } = computeNetBalances([tx('BUY', '1'), tx('SELL', '2')])
    expect(holdings).toEqual([])
    expect(nonPositiveAssetIds).toEqual(['btc'])
  })

  it('exakt 0 genetteter Bestand zählt nicht als Holding', () => {
    const { holdings, nonPositiveAssetIds } = computeNetBalances([tx('BUY', '1'), tx('SELL', '1')])
    expect(holdings).toEqual([])
    expect(nonPositiveAssetIds).toEqual(['btc'])
  })

  it('liefert leeres Ergebnis bei leerer Eingabe', () => {
    expect(computeNetBalances([])).toEqual({ holdings: [], nonPositiveAssetIds: [] })
  })
})
