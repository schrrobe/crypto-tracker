// Strings introduced by the Kontoauszug redesign. Kept separate from the
// legacy locale files so all six languages can be reviewed side by side.
const ui = {
  nav: {
    profile: 'Profil und Einstellungen',
  },
  overview: {
    refresh: 'Kurse und Bestände aktualisieren',
    saldo: 'Saldo',
    asOf: 'Stand {time}',
    currencyToggle: 'Saldo in {currency} anzeigen',
    changeSince: {
      '24h': 'seit gestern',
      '7d': 'in 7 Tagen',
      '30d': 'in 30 Tagen',
      '1y': 'in 12 Monaten',
    },
    positions: 'Positionen',
    positionsHint: 'Eine Zeile je Quelle. Tippen filtert die Bewegungen.',
    movements: 'Bewegungen',
    movementsOf: 'Bewegungen · {source}',
    showAllSources: 'Alle Quellen',
    allMovements: 'Alle Bewegungen',
    noMovements: 'Im sichtbaren Zeitraum wurde nichts gebucht.',
    movementsError: 'Bewegungen konnten nicht geladen werden.',
    openAsset: '{asset} öffnen',
  },
  movement: {
    opening: 'Anfangsbestand',
    in: 'Zugang',
    out: 'Abgang',
    origin: {
      SYNC: 'Sync',
      MANUAL: 'Manuell',
      IMPORT: 'Import',
    },
    count: '{n} Buchungen',
    balanceAfter: 'Quellenbestand: {qty}',
    atRate: 'zum Buchungskurs',
    today: 'Heute',
    yesterday: 'Gestern',
    window: 'Sichtbar: die letzten {days} Tage.',
    windowPro: 'Mit Pro siehst du 12 Monate.',
    loadMore: 'Ältere laden',
  },
  syncState: {
    ok: 'Stand {time}',
    busy: 'Synchronisiert …',
    error: 'Sync fehlgeschlagen',
    partial: 'Teilweise synchronisiert',
    never: 'Noch nie synchronisiert',
    manual: 'Manuell gepflegt',
    imported: 'Importiert',
  },
  change: {
    up: 'gestiegen um',
    down: 'gefallen um',
    flat: 'unverändert',
  },
  empty: {
    title: 'Dein Auszug ist noch leer',
    body: 'Verbinde eine Börse oder Wallet, importiere eine CSV-Datei oder trag einen Bestand von Hand ein. Wir lesen nur – handeln oder abheben können wir nicht.',
  },
  add: {
    title: 'Hinzufügen',
    open: 'Quelle oder Bestand hinzufügen',
    exchange: {
      title: 'Börse verbinden',
      body: 'Mit einem Read-only-API-Key. Handeln oder Abheben ist damit unmöglich.',
    },
    wallet: {
      title: 'Wallet beobachten',
      body: 'Nur die öffentliche Adresse – kein Seed, kein Private Key.',
    },
    csv: {
      title: 'CSV importieren',
      body: 'Bestände oder Transaktionen aus der Export-Datei deiner Börse.',
    },
    manual: {
      title: 'Von Hand erfassen',
      body: 'Für Cold Storage oder alles ohne Schnittstelle.',
    },
  },
  asset: {
    editLine: '{symbol} in {source} bearbeiten',
    deleteLine: '{symbol} aus {source} entfernen',
    title: '{symbol}',
    total: 'Gesamt',
    perSource: 'Nach Quelle',
    price: 'Kurs',
    value: 'Wert',
    share: '{pct} % des Portfolios',
    movements: 'Bewegungen',
    noHolding: 'Dieses Asset ist in keiner Quelle mehr vorhanden.',
    unpriced: 'Kein Kurs verfügbar – der Wert fließt nicht in den Saldo ein.',
    mapPrice: 'Kurs zuordnen',
  },
  holdings: {
    allocation: 'Verteilung',
    byAccount: 'Nach Kontotyp',
    assetsCount: '{n} Assets',
    sources: '{n} Quellen',
  },
  settings: {
    title: 'Profil',
    account: 'Konto',
    appearance: 'Darstellung',
    data: 'Daten & Steuern',
    plan: 'Tarif',
    danger: 'Konto löschen',
  },
  state: {
    loading: 'Wird geladen',
  },
  sources: {
    more: 'Mehr',
    syncAll: 'Alle synchronisieren',
    connected: 'Verbunden',
    data: 'Importe & Transaktionen',
    sync: 'Sync',
    rename: 'Umbenennen',
  },
  market: {
    note: 'Kurse in {currency} · Veränderung über 24 Stunden · Quelle: CoinGecko',
    held: 'im Bestand',
  },
  auth: {
    promise: 'Dein Krypto-Vermögen auf einen Blick – nur lesend. Wir können nichts handeln oder abheben.',
  },
  tx: {
    link: 'Mit Gegenbuchung verknüpfen',
    unlink: 'Verknüpfung lösen',
    swap: 'Als Tausch verknüpfen',
    unlinkSwap: 'Tausch-Verknüpfung lösen',
  },
  tax: {
    details: 'Annahmen lesen',
  },
}

export type UiMessages = typeof ui
export default ui
