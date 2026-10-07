import type { UiMessages } from './de'

const ui: UiMessages = {
  nav: {
    profile: 'Profil a nastavení',
  },
  overview: {
    refresh: 'Obnovit kurzy a stavy',
    saldo: 'Zůstatek',
    asOf: 'Stav k {time}',
    currencyToggle: 'Zobrazit zůstatek v {currency}',
    changeSince: {
      '24h': 'od včerejška',
      '7d': 'za 7 dní',
      '30d': 'za 30 dní',
      '1y': 'za 12 měsíců',
    },
    positions: 'Pozice',
    positionsHint: 'Jeden řádek na zdroj. Klepnutím filtrujete pohyby.',
    movements: 'Pohyby',
    movementsOf: 'Pohyby · {source}',
    showAllSources: 'Všechny zdroje',
    allMovements: 'Všechny pohyby',
    noMovements: 'Ve zobrazeném období nebylo nic zaúčtováno.',
    movementsError: 'Pohyby se nepodařilo načíst.',
    openAsset: 'Otevřít {asset}',
  },
  movement: {
    opening: 'Počáteční stav',
    in: 'Příjem',
    out: 'Výdej',
    origin: {
      SYNC: 'Synchronizace',
      MANUAL: 'Ručně',
      IMPORT: 'Import',
    },
    count: '{n} zaúčtování',
    balanceAfter: 'Stav ve zdroji: {qty}',
    atRate: 'v kurzu zaúčtování',
    today: 'Dnes',
    yesterday: 'Včera',
    window: 'Zobrazeno: posledních {days} dní.',
    windowPro: 'Pro zobrazuje 12 měsíců.',
    loadMore: 'Načíst starší',
  },
  syncState: {
    ok: 'Stav k {time}',
    busy: 'Synchronizace …',
    error: 'Synchronizace selhala',
    partial: 'Částečně synchronizováno',
    never: 'Nikdy nesynchronizováno',
    manual: 'Vedeno ručně',
    imported: 'Importováno',
  },
  change: {
    up: 'nárůst o',
    down: 'pokles o',
    flat: 'beze změny',
  },
  empty: {
    title: 'Váš výpis je zatím prázdný',
    body: 'Připojte burzu nebo peněženku, importujte soubor CSV nebo zadejte stav ručně. Pouze čteme – obchodovat ani vybírat nemůžeme.',
  },
  add: {
    title: 'Přidat',
    open: 'Přidat zdroj nebo stav',
    exchange: {
      title: 'Připojit burzu',
      body: 'Pomocí API klíče jen pro čtení. Obchodovat ani vybírat s ním nelze.',
    },
    wallet: {
      title: 'Sledovat peněženku',
      body: 'Jen veřejná adresa – žádný seed, žádný privátní klíč.',
    },
    csv: {
      title: 'Importovat CSV',
      body: 'Stavy nebo transakce z exportního souboru vaší burzy.',
    },
    manual: {
      title: 'Zadat ručně',
      body: 'Pro cold storage nebo vše bez API.',
    },
  },
  asset: {
    editLine: 'Upravit {symbol} v {source}',
    deleteLine: 'Odebrat {symbol} z {source}',
    title: '{symbol}',
    total: 'Celkem',
    perSource: 'Podle zdroje',
    price: 'Kurz',
    value: 'Hodnota',
    share: '{pct} % portfolia',
    movements: 'Pohyby',
    noHolding: 'Toto aktivum už není v žádném zdroji.',
    unpriced: 'Kurz není k dispozici – hodnota se nezapočítává do zůstatku.',
    mapPrice: 'Přiřadit kurz',
  },
  holdings: {
    allocation: 'Rozložení',
    byAccount: 'Podle typu účtu',
    assetsCount: '{n} aktiv',
    sources: '{n} zdrojů',
  },
  settings: {
    title: 'Profil',
    account: 'Účet',
    appearance: 'Vzhled',
    data: 'Data a daně',
    plan: 'Tarif',
    danger: 'Smazat účet',
  },
  state: {
    loading: 'Načítání',
  },
  sources: {
    more: 'Více',
    syncAll: 'Synchronizovat vše',
    connected: 'Připojené',
    data: 'Importy a transakce',
    sync: 'Synchronizovat',
    rename: 'Přejmenovat',
  },
  market: {
    note: 'Kurzy v {currency} · změna za 24 hodin · zdroj: CoinGecko',
    held: 'v držení',
  },
  auth: {
    promise: 'Váš kryptomajetek na první pohled – pouze ke čtení. Nemůžeme obchodovat ani vybírat.',
  },
  tx: {
    link: 'Propojit s protipoložkou',
    unlink: 'Zrušit propojení',
    swap: 'Propojit jako směnu',
    unlinkSwap: 'Zrušit propojení směny',
  },
  tax: {
    details: 'Číst předpoklady',
  },
}

export default ui
