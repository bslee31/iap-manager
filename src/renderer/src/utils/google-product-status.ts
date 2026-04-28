// Status badge tailwind classes for Google one-time products and their
// purchase options. Used by the Detail tabs and the product table.
//
// The matching status *label* used to live here as a hand-rolled map but has
// since moved to the i18n dictionary (`google.status.*`); each component
// now does its own `te()` / `t()` lookup so this file only deals with
// presentation styling.

export function statusColor(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-green-600/20 text-green-400'
    case 'INACTIVE':
    case 'INACTIVE_PUBLISHED':
      return 'bg-red-600/20 text-red-400'
    case 'DRAFT':
      return 'bg-yellow-600/20 text-yellow-400'
    default:
      return 'bg-[#393b40] text-gray-400'
  }
}
