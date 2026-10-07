import type { UiMessages } from './de'

const ui: UiMessages = {
  nav: {
    profile: 'Profile and settings',
  },
  overview: {
    refresh: 'Refresh prices and holdings',
    saldo: 'Balance',
    asOf: 'As of {time}',
    currencyToggle: 'Show balance in {currency}',
    changeSince: {
      '24h': 'since yesterday',
      '7d': 'over 7 days',
      '30d': 'over 30 days',
      '1y': 'over 12 months',
    },
    positions: 'Positions',
    positionsHint: 'One line per source. Tap to filter the movements.',
    movements: 'Movements',
    movementsOf: 'Movements · {source}',
    showAllSources: 'All sources',
    allMovements: 'All movements',
    noMovements: 'Nothing was booked in the visible period.',
    movementsError: 'Movements could not be loaded.',
    openAsset: 'Open {asset}',
  },
  movement: {
    opening: 'Opening balance',
    in: 'Incoming',
    out: 'Outgoing',
    origin: {
      SYNC: 'Sync',
      MANUAL: 'Manual',
      IMPORT: 'Import',
    },
    count: '{n} bookings',
    balanceAfter: 'Source balance: {qty}',
    atRate: 'at booking rate',
    today: 'Today',
    yesterday: 'Yesterday',
    window: 'Showing the last {days} days.',
    windowPro: 'Pro shows 12 months.',
    loadMore: 'Load older',
  },
  syncState: {
    ok: 'As of {time}',
    busy: 'Syncing …',
    error: 'Sync failed',
    partial: 'Partially synced',
    never: 'Never synced',
    manual: 'Maintained manually',
    imported: 'Imported',
  },
  change: {
    up: 'up by',
    down: 'down by',
    flat: 'unchanged',
  },
  empty: {
    title: 'Your statement is still empty',
    body: 'Connect an exchange or wallet, import a CSV file or enter a holding by hand. We only read – we cannot trade or withdraw.',
  },
  add: {
    title: 'Add',
    open: 'Add a source or holding',
    exchange: {
      title: 'Connect an exchange',
      body: 'With a read-only API key. Trading or withdrawing is impossible with it.',
    },
    wallet: {
      title: 'Watch a wallet',
      body: 'Only the public address – no seed, no private key.',
    },
    csv: {
      title: 'Import a CSV',
      body: "Holdings or transactions from your exchange's export file.",
    },
    manual: {
      title: 'Enter by hand',
      body: 'For cold storage or anything without an API.',
    },
  },
  asset: {
    editLine: 'Edit {symbol} in {source}',
    deleteLine: 'Remove {symbol} from {source}',
    title: '{symbol}',
    total: 'Total',
    perSource: 'By source',
    price: 'Price',
    value: 'Value',
    share: '{pct} % of portfolio',
    movements: 'Movements',
    noHolding: 'This asset is no longer held in any source.',
    unpriced: 'No price available – the value is not included in the balance.',
    mapPrice: 'Assign price',
  },
  holdings: {
    allocation: 'Allocation',
    byAccount: 'By account type',
    assetsCount: '{n} assets',
    sources: '{n} sources',
  },
  settings: {
    title: 'Profile',
    account: 'Account',
    appearance: 'Appearance',
    data: 'Data & taxes',
    plan: 'Plan',
    danger: 'Delete account',
  },
  state: {
    loading: 'Loading',
  },
  sources: {
    more: 'More',
    syncAll: 'Sync all',
    connected: 'Connected',
    data: 'Imports & transactions',
    sync: 'Sync',
    rename: 'Rename',
  },
  market: {
    note: 'Prices in {currency} · change over 24 hours · source: CoinGecko',
    held: 'held',
  },
  auth: {
    promise: 'Your crypto wealth at a glance – read-only. We cannot trade or withdraw anything.',
  },
  tx: {
    link: 'Link with counter-booking',
    unlink: 'Remove link',
    swap: 'Link as swap',
    unlinkSwap: 'Remove swap link',
  },
  tax: {
    details: 'Read assumptions',
  },
}

export default ui
