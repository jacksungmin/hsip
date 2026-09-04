let openSiteId = $state<string | null>(null)

export const workbenchState = {
  get siteId() { return openSiteId },
  open(siteId: string) { openSiteId = siteId },
  close() { openSiteId = null },
}
