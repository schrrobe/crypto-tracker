import type { UiMessages } from './de'

const ui: UiMessages = {
  nav: {
    profile: 'Profil i ustawienia',
  },
  overview: {
    refresh: 'Odśwież kursy i stany',
    saldo: 'Saldo',
    asOf: 'Stan na {time}',
    currencyToggle: 'Pokaż saldo w {currency}',
    changeSince: {
      '24h': 'od wczoraj',
      '7d': 'w 7 dni',
      '30d': 'w 30 dni',
      '1y': 'w 12 miesięcy',
    },
    positions: 'Pozycje',
    positionsHint: 'Jeden wiersz na źródło. Dotknij, aby filtrować ruchy.',
    movements: 'Ruchy',
    movementsOf: 'Ruchy · {source}',
    showAllSources: 'Wszystkie źródła',
    allMovements: 'Wszystkie ruchy',
    noMovements: 'W widocznym okresie nic nie zaksięgowano.',
    movementsError: 'Nie udało się wczytać ruchów.',
    openAsset: 'Otwórz {asset}',
  },
  movement: {
    opening: 'Saldo początkowe',
    in: 'Wpływ',
    out: 'Wypływ',
    origin: {
      SYNC: 'Synchronizacja',
      MANUAL: 'Ręcznie',
      IMPORT: 'Import',
    },
    count: '{n} księgowań',
    balanceAfter: 'Stan w źródle: {qty}',
    atRate: 'po kursie z księgowania',
    today: 'Dziś',
    yesterday: 'Wczoraj',
    window: 'Widoczne: ostatnie {days} dni.',
    windowPro: 'Pro pokazuje 12 miesięcy.',
    loadMore: 'Wczytaj starsze',
  },
  syncState: {
    ok: 'Stan na {time}',
    busy: 'Synchronizacja …',
    error: 'Synchronizacja nieudana',
    partial: 'Częściowo zsynchronizowano',
    never: 'Nigdy nie synchronizowano',
    manual: 'Prowadzone ręcznie',
    imported: 'Zaimportowano',
  },
  change: {
    up: 'wzrost o',
    down: 'spadek o',
    flat: 'bez zmian',
  },
  empty: {
    title: 'Twój wyciąg jest jeszcze pusty',
    body: 'Połącz giełdę lub portfel, zaimportuj plik CSV albo wpisz stan ręcznie. Tylko odczytujemy – nie możemy handlować ani wypłacać.',
  },
  add: {
    title: 'Dodaj',
    open: 'Dodaj źródło lub stan',
    exchange: {
      title: 'Połącz giełdę',
      body: 'Kluczem API tylko do odczytu. Handel ani wypłata nie są nim możliwe.',
    },
    wallet: {
      title: 'Obserwuj portfel',
      body: 'Tylko adres publiczny – bez seeda i klucza prywatnego.',
    },
    csv: {
      title: 'Importuj CSV',
      body: 'Stany lub transakcje z pliku eksportu Twojej giełdy.',
    },
    manual: {
      title: 'Wpisz ręcznie',
      body: 'Dla cold storage lub wszystkiego bez API.',
    },
  },
  asset: {
    editLine: 'Edytuj {symbol} w {source}',
    deleteLine: 'Usuń {symbol} z {source}',
    title: '{symbol}',
    total: 'Razem',
    perSource: 'Według źródła',
    price: 'Kurs',
    value: 'Wartość',
    share: '{pct} % portfela',
    movements: 'Ruchy',
    noHolding: 'Tego aktywa nie ma już w żadnym źródle.',
    unpriced: 'Brak kursu – wartość nie wchodzi do salda.',
    mapPrice: 'Przypisz kurs',
  },
  holdings: {
    allocation: 'Podział',
    byAccount: 'Według typu konta',
    assetsCount: '{n} aktywów',
    sources: '{n} źródeł',
  },
  settings: {
    title: 'Profil',
    account: 'Konto',
    appearance: 'Wygląd',
    data: 'Dane i podatki',
    plan: 'Plan',
    danger: 'Usuń konto',
  },
  state: {
    loading: 'Wczytywanie',
  },
  sources: {
    more: 'Więcej',
    syncAll: 'Synchronizuj wszystkie',
    connected: 'Połączone',
    data: 'Importy i transakcje',
    sync: 'Synchronizuj',
    rename: 'Zmień nazwę',
  },
  market: {
    note: 'Kursy w {currency} · zmiana w ciągu 24 godzin · źródło: CoinGecko',
    held: 'posiadane',
  },
  auth: {
    promise: 'Twój majątek krypto w jednym widoku – tylko do odczytu. Nie możemy handlować ani wypłacać.',
  },
  tx: {
    link: 'Połącz z przeciwną operacją',
    unlink: 'Usuń powiązanie',
    swap: 'Połącz jako wymianę',
    unlinkSwap: 'Usuń powiązanie wymiany',
  },
  tax: {
    details: 'Czytaj założenia',
  },
}

export default ui
