import { Loader2, AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string | ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative w-full max-w-sm mx-4 bg-white rounded-2xl shadow-2xl p-6">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-4 ${danger ? 'bg-red-50' : 'bg-amber-50'}`}>
          <AlertTriangle size={18} className={danger ? 'text-red-500' : 'text-amber-500'} />
        </div>
        <h3 className="text-[15px] font-semibold text-gray-900 text-center mb-2">{title}</h3>
        <div className="text-[13px] text-gray-500 text-center leading-relaxed mb-6">{description}</div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 border border-[rgba(0,0,0,0.1)] rounded-lg text-[13px] text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 py-2.5 rounded-lg text-[13px] font-medium flex items-center justify-center gap-2 disabled:opacity-60 transition-colors ${
              danger
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-[#3ECF8E] hover:bg-[#38c484] text-white'
            }`}
          >
            {loading && <Loader2 size={13} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
