interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

// Monochrome: gray default, green for active/success, red for error/exception only
const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
  // Green — active / success / connected
  ACTIVE:        { bg: 'bg-[#ECFDF5]', text: 'text-[#15803d]', dot: 'bg-[#22c55e]' },
  CONNECTED:     { bg: 'bg-[#ECFDF5]', text: 'text-[#15803d]', dot: 'bg-[#22c55e]' },
  SYNCED:        { bg: 'bg-[#ECFDF5]', text: 'text-[#15803d]', dot: 'bg-[#22c55e]' },
  DELIVERED:     { bg: 'bg-[#ECFDF5]', text: 'text-[#15803d]', dot: 'bg-[#22c55e]' },
  RESTOCKED:     { bg: 'bg-[#ECFDF5]', text: 'text-[#15803d]', dot: 'bg-[#22c55e]' },
  SOLD:          { bg: 'bg-[#ECFDF5]', text: 'text-[#15803d]', dot: 'bg-[#22c55e]' },

  // Red — errors / exceptions only
  ERROR:         { bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-500' },
  CANCELLED:     { bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-500' },
  SCRAPPED:      { bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-400' },

  // Amber — warnings / pending attention
  PENDING:       { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  INSPECTION:    { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  DEGRADED:      { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  RETURNED:      { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },

  // Gray — all other states
  PURCHASED:     { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  'IN-TRANSIT':  { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-500' },
  ARRIVED:       { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  PROCESSING:    { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-500' },
  PARTIAL:       { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  CLOSED:        { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-300' },
  UNPROCESSED:   { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-300' },
  TESTING:       { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  PHOTOGRAPHY:   { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  LISTING:       { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-500' },
  PICKED:        { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  PACKED:        { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-500' },
  SHIPPED:       { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-500' },
  OPEN:          { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  PICKING:       { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  LABEL_CREATED: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  IN_TRANSIT:    { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-500' },
  DISCONNECTED:  { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-300' },

  // Supply statuses
  LOW_STOCK:     { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  REORDER:       { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  OUT_OF_STOCK:  { bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-500' },
  DISCONTINUED:  { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-300' },
  ARCHIVED:      { bg: 'bg-gray-100', text: 'text-gray-400', dot: 'bg-gray-300' },

  // Supply invoice / transaction statuses
  CONFIRMED:       { bg: 'bg-[#ECFDF5]', text: 'text-[#15803d]', dot: 'bg-[#22c55e]' },
  NEEDS_AI_PARSE:  { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-400' },
  PURCHASE:        { bg: 'bg-[#ECFDF5]', text: 'text-[#15803d]', dot: 'bg-[#22c55e]' },
  ADJUSTMENT:      { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  TRANSFER:        { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
};

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const config = statusConfig[status] ?? { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-300' };
  const sizeClasses = size === 'sm' ? 'px-1.5 py-0.5 text-[10px] gap-1' : 'px-2 py-0.5 text-xs gap-1.5';

  return (
    <span className={`inline-flex items-center rounded-full font-medium tracking-tight ${config.bg} ${config.text} ${sizeClasses}`}>
      <span className={`rounded-full flex-shrink-0 ${size === 'sm' ? 'w-1 h-1' : 'w-1.5 h-1.5'} ${config.dot}`} />
      {status.replace(/_/g, ' ')}
    </span>
  );
}
