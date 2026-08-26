// Format a price for display in the product lists.
//
// Prices arrive as strings from two different sources — Apple's `customerPrice`
// ("1090", "0.99") and Google's units/nanos joined into "1090.00" — so the only
// thing they have in common is "a decimal string plus an ISO currency code".
// Intl gives us the thousands separator and, more importantly, the right number
// of decimals per currency: JPY and KRW have none, TWD and USD have two.
//
// The currency code is shown rather than the symbol: this app deals with 175
// territories, and "$" alone doesn't distinguish USD from CAD, AUD or HKD.
// price/currency are optional because the Google list leaves them unset for
// products with no purchase option yet.
export function formatPrice(
  price: string | undefined,
  currency: string | undefined,
  locale: string
): string {
  if (!price || !currency) return '-'

  const amount = Number(price)
  // An unparseable price is still information — show it as it came rather than
  // hiding it behind a dash.
  if (!Number.isFinite(amount)) return `${price} ${currency}`

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'code'
    }).format(amount)
  } catch {
    // Intl throws RangeError on a currency code it doesn't recognise. Falling
    // back keeps an unfamiliar code visible instead of blanking the cell.
    return `${price} ${currency}`
  }
}
