// Public app config (unauthenticated): drives the native force-update gate.
// All fields nullable → null means "not configured", gate stays inactive.
export interface AppConfigDto {
  minClientVersionAndroid: string | null
  minClientVersionIos: string | null
  storeUrlAndroid: string | null
  storeUrlIos: string | null
}
