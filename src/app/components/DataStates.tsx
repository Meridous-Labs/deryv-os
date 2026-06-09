import { Loader2, AlertCircle, Package, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
const DERYV_LOGO = 'https://byzjsafupehesiwbqkxt.supabase.co/storage/v1/object/public/brand-assets/deryv-logo.png';

export function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center h-full min-h-[400px]">
      <div className="flex flex-col items-center gap-4">
        <img src={DERYV_LOGO} alt="deryv" className="h-14 w-auto object-contain" />
        <Loader2 size={18} className="text-[#3ECF8E] animate-spin" />
      </div>
    </div>
  );
}

export function SectionLoader({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-px">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 bg-gray-50 animate-pulse rounded" />
      ))}
    </div>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
        {icon ?? <Package size={18} className="text-gray-400" />}
      </div>
      <p className="text-[13px] font-medium text-gray-900">{title}</p>
      {description && <p className="text-[13px] text-gray-400 mt-1 max-w-xs">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 flex items-center gap-1.5 px-3 py-1.5 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg transition-colors"
        >
          <Plus size={13} />
          {action.label}
        </button>
      )}
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center mb-3">
        <AlertCircle size={18} className="text-red-400" />
      </div>
      <p className="text-[13px] font-medium text-gray-900">Something went wrong</p>
      <p className="text-[13px] text-gray-400 mt-1 max-w-xs">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 px-3 py-1.5 border border-[rgba(0,0,0,0.1)] text-[13px] text-gray-600 rounded-lg hover:bg-gray-50"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function FullPageLoader() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white z-50">
      <div className="flex flex-col items-center gap-5">
        <img src={DERYV_LOGO} alt="deryv" className="h-16 w-auto object-contain" />
        <Loader2 size={18} className="text-[#3ECF8E] animate-spin" />
      </div>
    </div>
  );
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}

export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative w-full ${width} mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(0,0,0,0.07)]">
          <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors text-lg leading-none">×</button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-[rgba(0,0,0,0.07)] flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function FormField({ label, required, children, error }: { label: string; required?: boolean; children: ReactNode; error?: string | null }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
    </div>
  );
}

export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="py-2.5 border-b border-[rgba(0,0,0,0.04)] last:border-0">
      <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">{label}</p>
      <div className="text-[13px] text-gray-900 mt-0.5">{value ?? <span className="text-gray-400">—</span>}</div>
    </div>
  );
}

export const inputCls = 'w-full px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] placeholder:text-gray-400 bg-white';
export const selectCls = 'w-full px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] bg-white';
export const textareaCls = 'w-full px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] placeholder:text-gray-400 resize-none bg-white';
