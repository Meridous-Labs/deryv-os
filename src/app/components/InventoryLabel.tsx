import { forwardRef } from 'react';
import QRCode from 'react-qr-code';

export interface LabelItem {
  id: string;
  inventory_id?: string | null;
  product_title?: string | null;
  sku?: string | null;
  grade?: string | null;
  condition?: string | null;
  lot_id?: string | null;
  category?: string | null;
  status?: string | null;
  created_at?: string | null;
  warehouse_locations?: any;
  lots?: any;
}

interface InventoryLabelProps {
  item: LabelItem;
  size: '2x1' | '4x6';
  orgLogo?: string | null;
  qrUrl: string;
}

function locLabel(loc: any): string {
  if (!loc) return '—';
  return loc.location_code ?? ([loc.zone, loc.rack, loc.shelf, loc.bin].filter(Boolean).join('-') || '—');
}

export const InventoryLabel = forwardRef<HTMLDivElement, InventoryLabelProps>(
  ({ item, size, orgLogo, qrUrl }, ref) => {
    const fullInvId = item.inventory_id ?? item.id;
    const loc = locLabel(item.warehouse_locations);
    const lotShort = item.lot_id ? (item.lots?.lot_id || `#${item.lot_id.slice(0, 8).toUpperCase()}`) : '—';

    if (size === '2x1') {
      return (
        <div
          ref={ref}
          data-label-size="2x1"
          style={{
            width: '2in',
            height: '1in',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            padding: '0.06in 0.1in',
            backgroundColor: '#ffffff',
            boxSizing: 'border-box',
            overflow: 'hidden',
            gap: '0.1in',
            border: '1px solid #e5e7eb',
          }}
        >
          {/* Left: logo + inventory_id + product title */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.04in', overflow: 'hidden', minWidth: 0 }}>
            {orgLogo ? (
              <img src={orgLogo} style={{ height: '0.14in', width: 'auto', objectFit: 'contain', objectPosition: 'left center', display: 'block' }} alt="logo" />
            ) : (
              <span style={{ fontSize: '0.09in', fontWeight: 800, color: '#111', letterSpacing: '0.04em', fontFamily: 'system-ui, sans-serif' }}>deryv</span>
            )}
            <p style={{ fontSize: '0.11in', fontWeight: 700, fontFamily: 'monospace', color: '#111', margin: 0, letterSpacing: '0.03em' }}>
              {fullInvId}
            </p>
            <p style={{ fontSize: '0.09in', fontWeight: 600, color: '#333', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'system-ui, sans-serif', lineHeight: 1.1 }}>
              {item.product_title ?? '—'}
            </p>
            {(item.sku || loc) && (
              <div style={{ display: 'flex', gap: '0.08in', alignItems: 'center' }}>
                {item.sku && <span style={{ fontSize: '0.07in', color: '#666', fontFamily: 'monospace' }}>{item.sku}</span>}
                {loc !== '—' && <span style={{ fontSize: '0.07in', color: '#999', fontFamily: 'monospace' }}>{loc}</span>}
              </div>
            )}
          </div>
          {/* Right: QR code */}
          <div style={{ width: '0.7in', height: '0.7in', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '0.04in' }}>
            <QRCode value={qrUrl} size={64} viewBox="0 0 256 256" style={{ width: '100%', height: '100%', padding: '0.02in' }} />
          </div>
        </div>
      );
    }

    // 4x6" label (portrait)
    const createdDate = item.created_at ? new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;

    return (
      <div
        ref={ref}
        data-label-size="4x6"
        style={{
          width: '4in',
          height: '6in',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '0.2in 0.25in',
          backgroundColor: '#ffffff',
          boxSizing: 'border-box',
          border: '1px solid #e5e7eb',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', paddingBottom: '0.08in', borderBottom: '1.5px solid #e5e7eb', marginBottom: '0.1in' }}>
          {orgLogo ? (
            <img src={orgLogo} style={{ height: '0.28in', objectFit: 'contain', display: 'block' }} alt="logo" />
          ) : (
            <span style={{ fontSize: '0.18in', fontWeight: 800, color: '#111', letterSpacing: '0.06em' }}>deryv</span>
          )}
        </div>

        {/* QR Code */}
        <div style={{ width: '1.8in', height: '1.8in', padding: '0.05in', border: '1px solid #e5e7eb', borderRadius: '0.05in', marginBottom: '0.08in', backgroundColor: '#fff' }}>
          <QRCode value={qrUrl} size={160} viewBox="0 0 256 256" style={{ width: '100%', height: '100%' }} />
        </div>

        {/* Inventory ID */}
        <p style={{ fontSize: '0.13in', fontFamily: 'monospace', color: '#111', margin: '0 0 0.1in', letterSpacing: '0.06em', fontWeight: 700 }}>
          {fullInvId}
        </p>

        <div style={{ width: '100%', borderTop: '1px solid #f0f0f0', marginBottom: '0.1in' }} />

        {/* Product Title */}
        <p style={{ fontSize: '0.16in', fontWeight: 700, color: '#111', textAlign: 'center', margin: '0 0 0.08in', lineHeight: 1.2, maxWidth: '3.4in' }}>
          {item.product_title ?? '—'}
        </p>

        {/* Category + Status */}
        {(item.category || item.status) && (
          <div style={{ display: 'flex', gap: '0.15in', marginBottom: '0.08in' }}>
            {item.category && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '0.06in', color: '#aaa', margin: '0 0 0.02in', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Category</p>
                <p style={{ fontSize: '0.09in', fontWeight: 600, color: '#555', margin: 0 }}>{item.category}</p>
              </div>
            )}
            {item.status && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '0.06in', color: '#aaa', margin: '0 0 0.02in', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status</p>
                <p style={{ fontSize: '0.09in', fontWeight: 700, color: '#3ECF8E', margin: 0 }}>{item.status}</p>
              </div>
            )}
          </div>
        )}

        {/* SKU + Condition */}
        <div style={{ display: 'flex', gap: '0.2in', marginBottom: '0.06in' }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '0.06in', color: '#aaa', margin: '0 0 0.02in', textTransform: 'uppercase', letterSpacing: '0.06em' }}>SKU</p>
            <p style={{ fontSize: '0.1in', fontWeight: 600, color: '#333', margin: 0, fontFamily: 'monospace' }}>{item.sku ?? '—'}</p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '0.06in', color: '#aaa', margin: '0 0 0.02in', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Condition</p>
            <p style={{ fontSize: '0.1in', fontWeight: 600, color: '#333', margin: 0 }}>{item.condition ?? '—'}</p>
          </div>
        </div>

        <div style={{ width: '100%', borderTop: '1px solid #f0f0f0', margin: '0.06in 0' }} />

        {/* Location + LOT */}
        <div style={{ display: 'flex', gap: '0.3in', marginBottom: '0.06in' }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '0.06in', color: '#aaa', margin: '0 0 0.02in', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Location</p>
            <p style={{ fontSize: '0.11in', fontWeight: 700, color: '#333', margin: 0, fontFamily: 'monospace' }}>{loc}</p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '0.06in', color: '#aaa', margin: '0 0 0.02in', textTransform: 'uppercase', letterSpacing: '0.06em' }}>LOT</p>
            <p style={{ fontSize: '0.11in', fontWeight: 700, color: '#333', margin: 0, fontFamily: 'monospace' }}>{lotShort}</p>
          </div>
        </div>

        {createdDate && (
          <p style={{ fontSize: '0.07in', color: '#999', margin: '0.04in 0 0', fontFamily: 'monospace' }}>
            Created: {createdDate}
          </p>
        )}

        {/* Footer barcode */}
        <div style={{ marginTop: 'auto', paddingTop: '0.1in', borderTop: '1px solid #e5e7eb', width: '100%', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '2px', marginBottom: '0.03in' }}>
            {fullInvId.slice(0, 16).split('').map((ch, i) => (
              <div key={i} style={{ width: ch === '-' ? 3 : 2, height: '0.18in', backgroundColor: '#111', borderRadius: 1 }} />
            ))}
          </div>
          <p style={{ fontSize: '0.07in', fontFamily: 'monospace', color: '#666', margin: 0, letterSpacing: '0.12em' }}>
            {fullInvId}
          </p>
        </div>
      </div>
    );
  }
);

InventoryLabel.displayName = 'InventoryLabel';
