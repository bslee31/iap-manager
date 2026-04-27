// Shared status formatting for Google one-time products and their purchase
// options. Used by the Detail tabs (Info / Purchase Options / Pricing) so the
// status badge styling stays consistent across the modal.

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: '上架中',
    INACTIVE: '已下架',
    INACTIVE_PUBLISHED: '已下架（保留）',
    DRAFT: '草稿',
    NO_PURCHASE_OPTION: '未設定方案',
    UNKNOWN: '未知'
  }
  return map[status] || status
}

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
