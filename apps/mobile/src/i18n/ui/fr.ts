import type { UiMessages } from './de'

const ui: UiMessages = {
  nav: {
    profile: 'Profil et paramètres',
  },
  overview: {
    refresh: 'Actualiser cours et avoirs',
    saldo: 'Solde',
    asOf: 'Au {time}',
    currencyToggle: 'Afficher le solde en {currency}',
    changeSince: {
      '24h': 'depuis hier',
      '7d': 'sur 7 jours',
      '30d': 'sur 30 jours',
      '1y': 'sur 12 mois',
    },
    positions: 'Positions',
    positionsHint: 'Une ligne par source. Touchez pour filtrer les mouvements.',
    movements: 'Mouvements',
    movementsOf: 'Mouvements · {source}',
    showAllSources: 'Toutes les sources',
    allMovements: 'Tous les mouvements',
    noMovements: 'Aucune écriture sur la période visible.',
    movementsError: 'Impossible de charger les mouvements.',
    openAsset: 'Ouvrir {asset}',
  },
  movement: {
    opening: 'Solde d’ouverture',
    in: 'Entrée',
    out: 'Sortie',
    origin: {
      SYNC: 'Synchro',
      MANUAL: 'Manuel',
      IMPORT: 'Import',
    },
    count: '{n} écritures',
    balanceAfter: 'Solde de la source : {qty}',
    atRate: 'au cours de l’écriture',
    today: 'Aujourd’hui',
    yesterday: 'Hier',
    window: 'Affichage des {days} derniers jours.',
    windowPro: 'Pro affiche 12 mois.',
    loadMore: 'Charger plus ancien',
  },
  syncState: {
    ok: 'Au {time}',
    busy: 'Synchronisation …',
    error: 'Échec de la synchro',
    partial: 'Synchro partielle',
    never: 'Jamais synchronisé',
    manual: 'Géré manuellement',
    imported: 'Importé',
  },
  change: {
    up: 'en hausse de',
    down: 'en baisse de',
    flat: 'inchangé',
  },
  empty: {
    title: 'Votre relevé est encore vide',
    body: 'Connectez une plateforme ou un wallet, importez un fichier CSV ou saisissez un avoir à la main. Nous lisons seulement – impossible de trader ou de retirer.',
  },
  add: {
    title: 'Ajouter',
    open: 'Ajouter une source ou un avoir',
    exchange: {
      title: 'Connecter une plateforme',
      body: 'Avec une clé API en lecture seule. Trader ou retirer est impossible.',
    },
    wallet: {
      title: 'Suivre un wallet',
      body: 'Seulement l’adresse publique – ni seed, ni clé privée.',
    },
    csv: {
      title: 'Importer un CSV',
      body: 'Avoirs ou transactions depuis le fichier d’export de votre plateforme.',
    },
    manual: {
      title: 'Saisir à la main',
      body: 'Pour le cold storage ou tout ce qui n’a pas d’API.',
    },
  },
  asset: {
    editLine: 'Modifier {symbol} dans {source}',
    deleteLine: 'Retirer {symbol} de {source}',
    title: '{symbol}',
    total: 'Total',
    perSource: 'Par source',
    price: 'Cours',
    value: 'Valeur',
    share: '{pct} % du portefeuille',
    movements: 'Mouvements',
    noHolding: 'Cet actif n’est plus détenu dans aucune source.',
    unpriced: 'Aucun cours disponible – la valeur n’est pas incluse dans le solde.',
    mapPrice: 'Associer un cours',
  },
  holdings: {
    allocation: 'Répartition',
    byAccount: 'Par type de compte',
    assetsCount: '{n} actifs',
    sources: '{n} sources',
  },
  settings: {
    title: 'Profil',
    account: 'Compte',
    appearance: 'Affichage',
    data: 'Données et impôts',
    plan: 'Formule',
    danger: 'Supprimer le compte',
  },
  state: {
    loading: 'Chargement',
  },
  sources: {
    more: 'Plus',
    syncAll: 'Tout synchroniser',
    connected: 'Connectées',
    data: 'Imports et transactions',
    sync: 'Synchro',
    rename: 'Renommer',
  },
  market: {
    note: 'Cours en {currency} · variation sur 24 heures · source : CoinGecko',
    held: 'détenu',
  },
  auth: {
    promise: 'Votre patrimoine crypto d’un coup d’œil – en lecture seule. Nous ne pouvons ni trader ni retirer.',
  },
  tx: {
    link: 'Lier à la contrepartie',
    unlink: 'Supprimer le lien',
    swap: 'Lier comme échange',
    unlinkSwap: 'Supprimer le lien d’échange',
  },
  tax: {
    details: 'Lire les hypothèses',
  },
}

export default ui
