Make all header features and shipping scan-to-pack production functional.

Do not change visual design.
Do not use demo data.
Do not leave fake buttons.

HEADER — BREADCRUMB

Improve breadcrumb behavior:
- Breadcrumb should show:
  deryv / Primary Page / Current Subview
- Example:
  deryv / Inventory / All Items
  deryv / Shipping / All Shipments
  deryv / Settings / Branding
- Primary page crumb should navigate to that page’s default view.
- Subview crumb can remain text-only.
- Do not show incorrect or duplicated breadcrumb text.

HEADER — GLOBAL SEARCH / SCAN

The current global search input is visual only. Make it functional.

Locate the global search input in TopBar.tsx.

On Enter:
- Trim scanned/searched value.
- If empty, do nothing.
- Resolve value in this order:

1. If value contains selected=<uuid>, navigate to /inventory/all?selected=<uuid>
2. If value matches inventory_items.id, navigate to /inventory/all?selected=<id>
3. If value matches inventory_items.inventory_id scoped to organization_id, navigate to /inventory/all?selected=<id>
4. If value matches inventory_items.barcode_value scoped to organization_id, navigate to /inventory/all?selected=<id>
5. If value matches lots.lot_id scoped to organization_id, navigate to /lot-intake/all?selected=<id>
6. If value matches orders.order_id scoped to organization_id, navigate to /orders/all?selected=<id>
7. If value matches shipments.shipment_id scoped to organization_id, navigate to /shipping/all?selected=<id>
8. If value matches shipments.tracking_number scoped to organization_id, navigate to /shipping/all?selected=<id>

Show a small inline “No result found” message if no match exists.
Do not silently fail.
Keep all queries scoped to selected organization_id.
Keep scanner input compatible with Zebra DS2278 keyboard-wedge behavior.

HEADER — NOTIFICATIONS

Audit notifications dropdown:
- Mark single notification read should also scope update by organization_id.
- Mark all read should also scope update by organization_id.
- Clicking notification should navigate to entity route.
- If entity route is missing, use notification.route.
- If neither exists, notification should mark read but not navigate.
- Add support for these entity types:
  - lots
  - inventory_items
  - orders
  - shipments
  - returns
  - marketplace_listings
  - warehouse_locations
  - supplies
  - components
  - reports
  - manifest_imports
  - supply_invoice_imports
  - packing_scans

HEADER — + NEW MENU

Audit every + New action:
- New LOT → /lot-intake/all?action=new-lot
- Upload Manifest → /lot-intake/all?action=upload-manifest
- Add Inventory → /inventory/all?action=add-item
- Create Order → /orders/all?action=create-order
- Create Shipment → /shipping/all?action=create-shipment
- Upload Supply Invoice → /supplies/invoice-imports?action=upload-supply-invoice

Each destination page must:
- detect action param
- open correct modal
- remove action param only after modal opens
- show clear error if action is unsupported

HEADER — PROFILE MENU

The profile/avatar button is currently inert. Make it functional.

On click, open dropdown with:
- User name/email
- Current role
- Current organization
- Account Settings → /settings/account
- Organization Settings → /settings/org
- Branding → /settings/branding
- Sign Out

Sign Out should call existing AuthContext signOut().
Do not invent new auth logic.

SHIPPING — REAL SCAN TO PACK

Replace demo Scan to Pack panel with real workflow.

Current issue:
The Shipping page still shows demo steps and a “Next Step” button.

Required workflow:
1. User selects a shipment from the shipment list.
2. Scan to Pack panel loads selected shipment’s linked order and order_items.
3. Display each required order item:
   - inventory_id
   - product_title
   - required quantity
   - packed_quantity
   - packed / not packed state

Scanner input:
- Accept full QR URL containing selected=<uuid>
- Accept relative URL containing selected=<uuid>
- Accept raw inventory_items.id
- Accept inventory_items.inventory_id
- Accept inventory_items.barcode_value

On scan:
- Resolve inventory item scoped to organization_id.
- Confirm item belongs to selected shipment’s order_items.
- If item does not belong:
  - show red warning
  - insert packing_scans row with result = WRONG_ITEM
  - do not pack
- If item is already fully packed:
  - show amber warning
  - insert packing_scans row with result = DUPLICATE
  - do not increment
- If correct:
  - increment order_items.packed_quantity
  - if packed_quantity >= quantity, set packed_at and packed_by
  - update inventory_items.status = PACKED
  - insert packing_scans row with result = PACKED
  - log activity

When all order_items are fully packed:
- update orders.status = PACKED
- update shipments.status = PACKED
- set shipments.packed_at = now()
- set shipments.packed_by = current user
- create notification/activity:
  “Shipment packed and ready for label.”

Do not allow packing more than required quantity.
Do not allow wrong item to pack.
Do not allow scan without selected shipment/order.
Keep scan input focused after each scan.
Clear scan input after each scan.

GENERAL

- Keep all queries scoped to selected organization_id.
- Never submit empty strings into UUID fields.
- Use null for optional UUID fields.
- Do not invent schema columns.
- Every header link, filter, search, scan, notification, quick action, and profile action must either work or show a clear disabled state.