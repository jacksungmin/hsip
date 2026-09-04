import IMask from 'imask'

type CurrencyMaskOpts = {
  value: number | null
  onAccept: (value: number | null) => void
}

export function currencyMask(node: HTMLInputElement, opts: CurrencyMaskOpts) {
  const mask = IMask(node, {
    mask: Number,
    thousandsSeparator: ',',
    scale: 0,
    signed: false,
    min: 0,
  })

  if (opts.value !== null) mask.unmaskedValue = String(opts.value)

  mask.on('accept', () => {
    const raw = mask.unmaskedValue
    opts.onAccept(raw === '' ? null : parseInt(raw))
  })

  return {
    update(newOpts: CurrencyMaskOpts) {
      opts = newOpts
      const incoming = newOpts.value !== null ? String(newOpts.value) : ''
      if (mask.unmaskedValue !== incoming) {
        mask.unmaskedValue = incoming
      }
    },
    destroy() {
      mask.destroy()
    },
  }
}
