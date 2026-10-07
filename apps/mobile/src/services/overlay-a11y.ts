// Ionic hides the root router outlet from assistive tech (aria-hidden) while an
// overlay is open. With an ion-select popover nested in a modal, the attribute
// survives the last dismiss, and screen readers lose the entire app (tab bar
// included). After every overlay dismiss, clear it once nothing is open anymore.

const OVERLAYS = 'ion-modal, ion-popover, ion-alert, ion-action-sheet, ion-loading, ion-picker'
const DISMISS_EVENTS = [
  'ionModalDidDismiss',
  'ionPopoverDidDismiss',
  'ionAlertDidDismiss',
  'ionActionSheetDidDismiss',
  'ionLoadingDidDismiss',
]

function anyOverlayOpen(): boolean {
  return [...document.querySelectorAll(OVERLAYS)].some((el) => !el.classList.contains('overlay-hidden'))
}

function releaseRoot(): void {
  requestAnimationFrame(() => {
    if (anyOverlayOpen()) return
    document.querySelectorAll('ion-router-outlet[aria-hidden="true"], ion-nav[aria-hidden="true"]').forEach((el) => {
      if (!el.closest(OVERLAYS)) el.removeAttribute('aria-hidden')
    })
  })
}

export function installOverlayAriaGuard(): void {
  for (const name of DISMISS_EVENTS) document.addEventListener(name, releaseRoot)
}
