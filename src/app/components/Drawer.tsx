import { useEffect } from 'react';
import type { ReactNode } from 'react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Drawer({ open, onClose, title, subtitle, children, footer }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="ml-auto relative flex flex-col h-full bg-white shadow-2xl border-l border-[rgba(0,0,0,0.08)]" style={{ width: 520 }}>
        <div className="px-5 py-4 border-b border-[rgba(0,0,0,0.07)] flex items-start justify-between flex-shrink-0">
          <div className="min-w-0 pr-2">
            <h2 className="text-[15px] font-semibold text-gray-900 truncate">{title}</h2>
            {subtitle && <p className="text-[12px] text-gray-400 mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700 text-[18px] leading-none flex-shrink-0"
          >×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="px-5 py-3.5 border-t border-[rgba(0,0,0,0.07)] flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
