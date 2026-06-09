Audit and harden deryv beta for schema consistency, operational accuracy, and production readiness.

Do not change visual design.

Do not add new features.

Focus only on:
- schema alignment
- cost accuracy
- transaction safety
- notification correctness
- packaging templates
- supplies
- components
- bundles
- manifest imports

Use the existing Supabase schema exactly as it exists.

--------------------------------------------------
GENERAL RULES
--------------------------------------------------

- Never submit empty strings into UUID fields.
- Use null for optional UUID fields.
- Every tenant-scoped query must use organization_id.
- Do not invent columns.
- Do not create duplicate cost calculations.
- Use database trigger results as the source of truth.
- Reload affected records after inserts that invoke triggers.
- Do not manually re-apply calculations already performed by triggers.

--------------------------------------------------
PACKAGING TEMPLATES
--------------------------------------------------

packaging_template_items schema:

- id
- organization_id
- template_id
- supply_id
- quantity
- notes

Requirements:

- Every insert into packaging_template_items must include organization_id.
- Every update must include organization scope.
- Every delete must include organization scope.
- Every select must include organization scope.
- Never submit empty strings into template_id.
- Never submit empty strings into supply_id.
- Use null where appropriate.

Saving a template must:

- create or update packaging_templates
- create or update packaging_template_items
- reload saved template items from database
- display the saved template accurately

--------------------------------------------------
PACKAGING TEMPLATE APPLICATION
--------------------------------------------------

When applying a packaging template:

- Validate all referenced supplies exist.
- Validate quantities are available.
- Prevent negative inventory.
- Show shortages before confirmation.
- Create supply_usage_logs records.
- Allow database triggers to update supply quantities.
- Do not manually decrement quantity_on_hand in frontend.
- Reload supplies after completion.
- Reload affected inventory items after completion.
- Reload shipments after completion if shipment-related.

--------------------------------------------------
SUPPLY INVENTORY
--------------------------------------------------

Database triggers already adjust inventory quantities.

After inserting supply_transactions:

- Do not manually update supplies.quantity_on_hand.
- Reload supplies from database.

After inserting supply_usage_logs:

- Do not manually update supplies.quantity_on_hand.
- Do not manually update inventory_items.supply_cost.
- Do not manually update shipment packaging costs.
- Reload affected records and use returned values.

Low stock notifications:

- Use actual database values after reload.
- Trigger only when quantity_on_hand <= reorder_point.
- Do not repeatedly create duplicate low-stock notifications while inventory remains below reorder point.
- Allow notifications again only after inventory rises above reorder point and later falls below it again.

--------------------------------------------------
SUPPLY USAGE LOGS
--------------------------------------------------

Actual schema uses:

unit_cost_at_use

Do not use:

unit_cost

Replace all frontend references accordingly.

Schema:

- supply_id
- inventory_item_id
- order_id
- shipment_id
- quantity_used
- unit_cost_at_use
- total_cost
- notes
- organization_id

Use existing fields only.

--------------------------------------------------
COMPONENTS
--------------------------------------------------

Component schema:

- organization_id
- component_code
- category_id
- vendor_id
- name
- brand
- model
- sku
- upc
- unit_cost
- quantity_available
- reorder_point
- status
- notes

Component transaction requirements:

- Do not allow quantity_available below zero.
- Validate available quantity before deduction.
- For PURCHASE:
  - update quantity
  - update unit_cost if supplied
- For ADJUSTMENT:
  - apply adjustment correctly
- For RETURN:
  - restore inventory
- For TRANSFER:
  - update quantity correctly

Low stock notifications:

- Trigger only when quantity crosses below reorder point.
- Do not generate duplicate notifications repeatedly.

--------------------------------------------------
INVENTORY ITEM COMPONENTS
--------------------------------------------------

Actual schema:

- organization_id
- inventory_item_id
- component_id
- quantity
- unit_cost
- total_cost
- attached_by
- created_at

Do not reference:

unit_cost_at_time

Use:

unit_cost

only.

--------------------------------------------------
COMPONENT ATTACHMENT COST ROLLUPS
--------------------------------------------------

When attaching a component:

- Validate available quantity.
- Reduce component quantity_available.
- Create inventory_item_components record.
- Update inventory_items.component_cost.
- Update inventory_items.total_cost_basis.
- Log activity.

When removing a component:

- Restore quantity_available.
- Remove attachment record.
- Recalculate component_cost.
- Recalculate total_cost_basis.
- Log activity.

total_cost_basis should reflect:

weighted_acquisition_cost
+ component_cost
+ supply_cost
+ shipping_cost
+ marketplace_fees

Use existing fields only.

Do not double-count any costs.

--------------------------------------------------
BUNDLE TEMPLATES
--------------------------------------------------

bundle_templates schema:

- id
- organization_id
- name
- description
- active
- created_at
- updated_at

bundle_template_components schema:

- id
- bundle_template_id
- component_id
- quantity

IMPORTANT:

bundle_template_components DOES NOT contain organization_id.

Do not:

- insert organization_id
- update organization_id
- filter directly by organization_id

Organization scope must come through:

bundle_templates.organization_id

using relational queries.

--------------------------------------------------
BUNDLE MANAGEMENT
--------------------------------------------------

Creating bundle templates:

- Validate components exist.
- Save bundle template.
- Save bundle_template_components.
- Reload bundle_template_components after save.

Editing bundle templates:

- Load existing components.
- Update child records correctly.
- Remove deleted child records.
- Reload after save.

Deleting bundle templates:

- Remove child records safely.
- Remove template safely.

--------------------------------------------------
ACTIVITY LOGGING
--------------------------------------------------

Correct helper signature:

logActivity(
  orgId,
  userId,
  message,
  entityType?,
  entityId?,
  eventType?
)

Audit project-wide.

Fix any calls using:

entityType as message
or
incorrect parameter order.

Especially review:

- Components
- Supplies
- Packaging Templates
- Manifest Imports
- Bundle Templates

--------------------------------------------------
MANIFEST IMPORT
--------------------------------------------------

Manifest import should remain condition-agnostic.

Condition:

- null after import
- never parsed from manifest

Inventory items created via manifest:

- condition = null
- status = UNPROCESSED

Manifest confirmation:

If product title is missing:

- warn user
- require acknowledgement before import
- allow edit before confirmation

Do not silently create large quantities of Untitled Item records.

Keep existing parser priority logic.

--------------------------------------------------
NOTIFICATIONS
--------------------------------------------------

Verify notification routing.

Every notification should:

- navigate correctly
- open the correct page
- open the correct entity if applicable

Review:

- supply notifications
- component notifications
- manifest review notifications
- shipment exception notifications
- return notifications

Ensure routes are valid.

--------------------------------------------------
FINAL AUDIT
--------------------------------------------------

Perform a project-wide search for:

- organization_id on bundle_template_components
- unit_cost_at_time
- unit_cost in supply_usage_logs
- manual quantity_on_hand updates after trigger-based inserts
- incorrect logActivity calls
- empty string UUID submissions

Correct all occurrences.

Do not add new functionality.

Focus exclusively on correctness, schema alignment, transaction safety, cost integrity, and operational reliability.