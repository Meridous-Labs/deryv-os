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
    const lotShort = item.lot_id
      ? (item.lots?.lot_id || `#${item.lot_id.slice(0, 8).toUpperCase()}`)
      : '—';

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
            alignItems: 'stretch',
            padding: '0.07in 0.08in',
            backgroundColor: '#ffffff',
            boxSizing: 'border-box',
            gap: '0.08in',
            border: '1px solid #e5e7eb',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {/* Left: logo + ID + title + sku/loc */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            minWidth: 0,
          }}>
            {/* Top: logo or brand */}
            <div>
              {orgLogo ? (
                <img
                  src={orgLogo}
                  style={{ height: '0.18in', width: 'auto', objectFit: 'contain', objectPosition: 'left center', display: 'block' }}
                  alt="logo"
                />
              ) : (
                <span style={{ fontSize: '0.08in', fontWeight: 800, color: '#111', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  deryv
                </span>
              )}
            </div>

            {/* Inventory ID — largest, most prominent */}
            <p style={{
              fontSize: '0.1in',
              fontWeight: 700,
              fontFamily: 'monospace',
              color: '#111',
              margin: '0.02in 0 0.01in',
              letterSpacing: '0.01em',
              lineHeight: 1,
              whiteSpace: 'nowrap',
            }}>
              {fullInvId}
            </p>

            {/* Product title */}
            <p style={{
              fontSize: '0.085in',
              fontWeight: 600,
              color: '#222',
              margin: 0,
              whiteSpace: 'nowrap',
              lineHeight: 1.2,
            }}>
              {item.product_title ?? '—'}
            </p>

            {/* Bottom row: SKU + LOT/Location */}
            <div style={{ display: 'flex', gap: '0.06in', alignItems: 'center', marginTop: '0.02in' }}>
              {item.sku && (
                <span style={{ fontSize: '0.065in', color: '#555', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  {item.sku}
                </span>
              )}
              {loc !== '—' && (
                <span style={{ fontSize: '0.065in', color: '#888', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  {loc}
                </span>
              )}
              {item.lot_id && (
                <span style={{ fontSize: '0.065in', color: '#111', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  {lotShort}
                </span>
              )}
            </div>
          </div>

          {/* Right: QR code — taller, fills height */}
          <div style={{
            width: '0.78in',
            height: '0.78in',
            flexShrink: 0,
            alignSelf: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#fff',
            border: '1px solid #ddd',
            borderRadius: '0.03in',
            padding: '0.025in',
          }}>
            <QRCode
              value={qrUrl}
              size={72}
              viewBox="0 0 256 256"
              style={{ width: '100%', height: '100%' }}
            />
          </div>
        </div>
      );
    }

    // ── 4×6" label (portrait) ──────────────────────────────────────────────
    const createdDate = item.created_at
      ? new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null;

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
          padding: '0.22in 0.28in 0.18in',
          backgroundColor: '#ffffff',
          boxSizing: 'border-box',
          border: '1px solid #e5e7eb',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Header: logo + org name */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
          paddingBottom: '0.1in',
          borderBottom: '2px solid #111',
          marginBottom: '0.14in',
        }}>
          {orgLogo ? (
            <img src={orgLogo} style={{ height: '0.3in', objectFit: 'contain', display: 'block' }} alt="logo" />
          ) : (
            <span style={{ fontSize: '0.2in', fontWeight: 800, color: '#111', letterSpacing: '0.06em' }}>deryv</span>
          )}
          <span style={{ fontSize: '0.08in', color: '#555', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Inventory Label
          </span>
        </div>

        {/* QR Code — centered, prominent */}
        <div style={{
          width: '2in',
          height: '2in',
          padding: '0.06in',
          border: '1.5px solid #ddd',
          borderRadius: '0.06in',
          marginBottom: '0.1in',
          backgroundColor: '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}>
          <QRCode value={qrUrl} size={172} viewBox="0 0 256 256" style={{ width: '100%', height: '100%' }} />
        </div>

        {/* Inventory ID — large monospace */}
        <p style={{
          fontSize: '0.16in',
          fontFamily: 'monospace',
          color: '#111',
          margin: '0 0 0.12in',
          letterSpacing: '0.06em',
          fontWeight: 700,
          textAlign: 'center',
        }}>
          {fullInvId}
        </p>

        {/* Product Title */}
        <p style={{
          fontSize: '0.18in',
          fontWeight: 700,
          color: '#111',
          textAlign: 'center',
          margin: '0 0 0.12in',
          lineHeight: 1.25,
          maxWidth: '3.4in',
        }}>
          {item.product_title ?? '—'}
        </p>

        <div style={{ width: '100%', borderTop: '1px solid #eee', marginBottom: '0.12in' }} />

        {/* Row 1: Category + Status */}
        {(item.category || item.status) && (
          <div style={{ display: 'flex', gap: '0.3in', marginBottom: '0.1in', justifyContent: 'center' }}>
            {item.category && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '0.065in', color: '#aaa', margin: '0 0 0.025in', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Category</p>
                <p style={{ fontSize: '0.1in', fontWeight: 600, color: '#444', margin: 0 }}>{item.category}</p>
              </div>
            )}
            {item.status && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '0.065in', color: '#aaa', margin: '0 0 0.025in', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Status</p>
                <p style={{ fontSize: '0.1in', fontWeight: 700, color: '#111', margin: 0 }}>{item.status}</p>
              </div>
            )}
          </div>
        )}

        {/* Row 2: SKU + Condition + Grade */}
        <div style={{ display: 'flex', gap: '0.25in', marginBottom: '0.1in', justifyContent: 'center' }}>
          {item.sku && (
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '0.065in', color: '#aaa', margin: '0 0 0.025in', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>SKU</p>
              <p style={{ fontSize: '0.1in', fontWeight: 600, color: '#333', margin: 0, fontFamily: 'monospace' }}>{item.sku}</p>
            </div>
          )}
          {item.condition && (
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '0.065in', color: '#aaa', margin: '0 0 0.025in', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Condition</p>
              <p style={{ fontSize: '0.1in', fontWeight: 600, color: '#333', margin: 0 }}>{item.condition}</p>
            </div>
          )}
          {item.grade && (
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '0.065in', color: '#aaa', margin: '0 0 0.025in', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Grade</p>
              <p style={{ fontSize: '0.1in', fontWeight: 700, color: '#333', margin: 0 }}>{item.grade}</p>
            </div>
          )}
        </div>

        <div style={{ width: '100%', borderTop: '1px solid #eee', margin: '0.04in 0 0.1in' }} />

        {/* Row 3: Location + LOT */}
        <div style={{ display: 'flex', gap: '0.35in', marginBottom: '0.06in', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '0.065in', color: '#aaa', margin: '0 0 0.025in', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Location</p>
            <p style={{ fontSize: '0.1in', fontWeight: 700, color: '#333', margin: 0, fontFamily: 'monospace' }}>{loc}</p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '0.065in', color: '#aaa', margin: '0 0 0.025in', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>LOT</p>
            <p style={{ fontSize: '0.1in', fontWeight: 700, color: '#333', margin: 0, fontFamily: 'monospace' }}>{lotShort}</p>
          </div>
        </div>

        {createdDate && (
          <p style={{ fontSize: '0.075in', color: '#bbb', margin: '0.05in 0 0', fontFamily: 'monospace' }}>
            Created: {createdDate}
          </p>
        )}

        {/* Footer: barcode simulation */}
        <div style={{
          marginTop: 'auto',
          paddingTop: '0.1in',
          borderTop: '1.5px solid #111',
          width: '100%',
          textAlign: 'center',
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5px', marginBottom: '0.04in', alignItems: 'flex-end' }}>
            {fullInvId.slice(0, 20).split('').map((ch, i) => (
              <div
                key={i}
                style={{
                  width: ch === '-' ? 4 : (i % 3 === 0 ? 3 : 2),
                  height: ch === '-' ? '0.12in' : '0.18in',
                  backgroundColor: '#111',
                  borderRadius: 1,
                }}
              />
            ))}
          </div>
          <p style={{ fontSize: '0.075in', fontFamily: 'monospace', color: '#555', margin: 0, letterSpacing: '0.1em' }}>
            {fullInvId}
          </p>
        </div>
      </div>
    );
  }
);

InventoryLabel.displayName = 'InventoryLabel';
