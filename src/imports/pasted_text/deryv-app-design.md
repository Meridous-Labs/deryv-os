Build a production-grade SaaS web application called “deryv” — an AI-native warehouse, inventory, fulfillment, and operational workflow operating system for modern ecommerce, liquidation, and warehouse businesses.

CRITICAL:
- Style the UI heavily inspired by the WHITE version of Supabase.
- White/light grey backgrounds.
- Soft borders.
- Subtle shadows.
- Rounded corners.
- Minimalistic operational SaaS feel.
- Modern typography.
- Calm and professional.
- Very clean spacing.
- Accent color ONLY:
  Supabase green #3ECF8E
- Charcoal text (#111827 / #1F2937 range)
- Avoid clutter.
- Avoid ERP-looking interfaces.
- Avoid industrial styling.
- Avoid dark mode for now.
- Make the app feel welcoming for startups but scalable for enterprise operations.

STACK / ARCHITECTURE:
- Multi-tenant SaaS architecture.
- Organizations can have multiple warehouses/locations.
- Build frontend-first but architect for:
  Supabase + Vercel + GitHub + Make integrations.
- All operational data should conceptually revolve around:
  organization_id
- Design with future mobile responsiveness in mind.

APP NAME:
deryv

TAGLINE:
operate. sync. grow.

PRIMARY PRODUCT PHILOSOPHY:
“Operational infrastructure for modern inventory businesses.”

CORE UX PRINCIPLES:
- Workflow-first.
- Queue-first.
- Action-oriented.
- Fast operational visibility.
- Minimal clicks.
- One physical item = one inventory record.
- Complex underneath, simple on surface.
- Built by operators, not consultants.
- Friendly and approachable while operationally powerful.

TOP-LEVEL NAVIGATION:
1. Command Center
2. LOT Intake
3. Inventory
4. Warehouse
5. Marketplace
6. Orders
7. Shipping
8. Returns
9. Partners
10. Reports
11. Integrations
12. AI Ops
13. Settings

GLOBAL LAYOUT:
- Left collapsible sidebar.
- Top search/global actions bar.
- Workspace/org switcher.
- Notifications.
- User menu.
- Global quick action button:
  “+ New”

DESIGN THE FOLLOWING PAGES:

========================================
1. COMMAND CENTER
========================================

Purpose:
Daily operational overview.

Include:
- KPI cards:
  - Active LOTS
  - Inventory in Processing
  - Active Listings
  - Open Orders
  - Pending Shipments
  - Returns Pending
  - Gross Recovery %
  - Net Margin %
- Operational queues overview.
- Recent activity feed.
- AI operational insights panel.
- Quick action buttons:
  - New LOT
  - Upload Manifest
  - Add Inventory
  - Create Shipment
  - Generate Report
- Workflow pipeline visualization:
  Purchased → In-Transit → Arrived → Processing → Active → Packed → Shipped → Delivered

========================================
2. LOT INTAKE
========================================

Purpose:
Truckloads, manifests, pallets, invoices, liquidation acquisitions.

Build:
- LOTS table view.
- LOT detail page.
- Upload manifest workflow.
- Upload invoice workflow.
- Landed cost section.
- MSRP-weighted allocation visualization.
- Vendor assignment.
- Funding partner assignment.
- Arrival tracking.
- Truckload metadata.
- Notes/photos/files.

LOT STATUSES:
- PURCHASED
- IN-TRANSIT
- ARRIVED
- PROCESSING
- ACTIVE
- PARTIAL
- CLOSED

FIELDS:
- LOT ID
- Vendor
- Funding Partner
- Purchase Price
- Freight Cost
- Handling Cost
- Total MSRP
- Recovery Amount
- Gross Margin
- Net Margin
- Recovery %
- Item Count
- Truckload #
- Manifest File
- Invoice File
- Photos
- Notes

========================================
3. INVENTORY
========================================

Purpose:
One physical item = one inventory record.

Build:
- Inventory table/grid.
- Gallery/image view.
- Inventory detail page.
- QR/barcode support UI.
- Item lifecycle tracking.
- Marketplace sync status.
- Listing status.
- Warehouse location assignment.
- Scan inventory modal.
- Batch actions.

INVENTORY STATUSES:
- UNPROCESSED
- TESTING
- PHOTOGRAPHY
- LISTING
- ACTIVE
- PICKED
- PACKED
- SHIPPED
- DELIVERED
- RETURNED
- SCRAPPED

FIELDS:
- Inventory ID
- LOT
- SKU
- Product Title
- Manufacturer MSRP
- Weighted Acquisition Cost
- Condition
- Marketplace Status
- Warehouse Location
- Photos
- Shipping Cost
- Marketplace Fees
- Gross Recovery %
- Net Recovery %
- Net Margin $
- Net Margin %
- Barcode
- QR Code
- Notes

========================================
4. WAREHOUSE
========================================

Purpose:
Warehouse structure and inventory movement.

Build:
- Warehouse location hierarchy:
  Zone → Rack → Shelf → Bin
- Visual warehouse mapping cards.
- Inventory movement history.
- Scan-to-move workflow.
- Capacity visualization.
- Inventory aging indicators.

========================================
5. MARKETPLACE
========================================

Purpose:
Listing management across ecommerce channels.

Integrations-ready:
- eBay
- Shopify

Build:
- Marketplace listings table.
- Listing detail view.
- Listing sync status.
- Listing health indicators.
- AI-generated listing preview section.
- Bulk listing actions.

FIELDS:
- Marketplace
- Listing Status
- Listing Price
- Marketplace Fees
- Sync Status
- Published At
- Last Synced At

========================================
6. ORDERS
========================================

Purpose:
Order management across all channels.

Build:
- Orders table.
- Order detail page.
- Fulfillment status.
- Shipment linkage.
- Customer details.
- Packing workflow.
- Exception handling.

ORDER STATUSES:
- OPEN
- PICKING
- PACKED
- SHIPPED
- DELIVERED
- RETURNED
- CANCELLED

========================================
7. SHIPPING
========================================

Purpose:
Fulfillment and shipment workflows.

Integrations-ready:
- ShipStation
- UPS
- FedEx
- USPS

Build:
- Shipment queue.
- Label status.
- Tracking sync.
- Packing workflow.
- Shipment detail page.
- Scan-to-pack interface.

========================================
8. RETURNS
========================================

Purpose:
Return inspection and recovery workflows.

Build:
- Returns queue.
- Return detail page.
- Inspection workflow.
- Refund tracking.
- Restock vs scrap decisions.
- Damage documentation.

========================================
9. PARTNERS
========================================

Purpose:
Partner-funded inventory and vendor relationships.

Build:
- Vendor management.
- Funding partner management.
- Recovery tracking.
- Principal repayment visualization.
- Profit split tracking.

========================================
10. REPORTS
========================================

Purpose:
Operational reporting and PDF generation.

Build:
- Custom report builder UI.
- Filters.
- Export actions.
- PDF generation preview cards.
- Saved reports.
- Recovery analytics.
- Margin analytics.
- Inventory aging.
- Vendor performance.
- Marketplace performance.

========================================
11. INTEGRATIONS
========================================

Purpose:
External software connections.

Build beautiful integration cards for:
- Shopify
- eBay
- ShipStation
- QuickBooks
- A2X
- Stripe
- Gusto
- Melio
- OpenAI
- Make

Each integration card should include:
- Connection status
- Last sync
- Sync health
- Configure button

========================================
12. AI OPS
========================================

Purpose:
AI-native operational intelligence.

Build:
- AI listing generator.
- Manifest parser.
- Recovery insights.
- Inventory anomaly detection.
- AI workflow suggestions.
- AI-generated operational summaries.

Keep this clean/minimal/future-forward.

========================================
13. SETTINGS
========================================

Build:
- Organization settings.
- Warehouse settings.
- User management.
- Permissions.
- API keys.
- Notification settings.
- Branding settings.

========================================
VISUAL REFERENCES
========================================

Use design inspiration from:
- Supabase
- Linear
- Vercel
- Stripe Dashboard
- Notion

BUT:
Make it operationally warehouse-focused.

========================================
IMPORTANT UI RULES
========================================

- Avoid overwhelming data density.
- Use cards, spacing, and clean grouping.
- Prioritize image-first inventory workflows.
- Prioritize operational actions.
- Prioritize queue visibility.
- Minimize unnecessary charts.
- Use subtle micro-interactions.
- Use rounded modern tables.
- Make every screen feel production-ready.
- Make it feel like a modern SaaS product people would pay for immediately.

Generate:
- Complete SaaS dashboard UI system.
- All pages.
- Shared design system.
- Components.
- Tables.
- Forms.
- Modals.
- Empty states.
- Loading states.
- Queue layouts.
- Responsive desktop-first operational UX.