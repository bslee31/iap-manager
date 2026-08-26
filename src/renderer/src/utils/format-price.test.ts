import { describe, it, expect } from 'vitest'
import { formatPrice } from './format-price'

// Intl separates the currency code from the number with U+00A0, which keeps the
// two from wrapping apart in a narrow column — worth keeping in the output, but
// not worth pinning in assertions: ICU has changed which space character it uses
// between versions. Compare with whitespace normalised instead.
const fmt = (price: string | undefined, currency: string | undefined) =>
  formatPrice(price, currency, 'zh-TW').replace(/\s/g, ' ')

describe('formatPrice', () => {
  it('adds a thousands separator', () => {
    expect(fmt('1090', 'TWD')).toBe('TWD 1,090.00')
  })

  it('uses the decimal count the currency actually has', () => {
    // JPY and KRW have no minor unit; hardcoding two decimals would invent one.
    expect(fmt('1200', 'JPY')).toBe('JPY 1,200')
    expect(fmt('12000', 'KRW')).toBe('KRW 12,000')
    expect(fmt('0.99', 'USD')).toBe('USD 0.99')
  })

  it('normalises the two sources to the same output', () => {
    // Apple sends "1090", Google sends "1090.00" for the same price.
    expect(fmt('1090', 'TWD')).toBe(fmt('1090.00', 'TWD'))
  })

  it('shows a dash when either half is missing', () => {
    expect(fmt('', 'TWD')).toBe('-')
    expect(fmt('1090', '')).toBe('-')
    expect(fmt(undefined, undefined)).toBe('-')
  })

  it('falls back to the raw values for a currency code Intl rejects', () => {
    // Intl throws RangeError here; blanking the cell would hide real data.
    expect(fmt('1090', 'XX')).toBe('1090 XX')
  })

  it('falls back to the raw values when the price is not a number', () => {
    expect(fmt('n/a', 'TWD')).toBe('n/a TWD')
  })
})
