let locked = $state(false)

export const mapInteraction = {
  get locked() { return locked },
  lock() { locked = true },
  unlock() { locked = false },
}
