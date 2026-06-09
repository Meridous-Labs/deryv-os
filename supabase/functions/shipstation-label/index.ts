import { createClient } from "npm:@supabase/supabase-js";

function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

async function getAuthUser(authHeader: string | null) {
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const supabase = adminClient();
  const { data: { user } } = await supabase.auth.getUser(token);
  return user;
}

async function getShipStationCredentials(organizationId: string): Promise<{ apiKey: string; apiSecret: string } | null> {
  const supabase = adminClient();

  const { data: connection, error } = await supabase
    .from('integration_connections')
    .select('config')
    .eq('organization_id', organizationId)
    .eq('provider', 'shipstation')
    .eq('status', 'CONNECTED')
    .single();

  if (error || !connection) {
    console.error('ShipStation credentials not found:', error);
    return null;
  }

  const apiKey = connection.config?.api_key;
  const apiSecret = connection.config?.api_secret;

  if (!apiKey || !apiSecret) {
    console.error('ShipStation credentials incomplete');
    return null;
  }

  return { apiKey, apiSecret };
}

function shipStationAuth(apiKey: string, apiSecret: string): string {
  const credentials = btoa(`${apiKey}:${apiSecret}`);
  return `Basic ${credentials}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  try {
    const caller = await getAuthUser(req.headers.get('Authorization'));
    if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const body = await req.json();
    const { organization_id, shipment_id, carrier_code, service_code } = body;

    if (!organization_id || !shipment_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    // Get ShipStation credentials
    const credentials = await getShipStationCredentials(organization_id);
    if (!credentials) {
      return new Response(JSON.stringify({ error: 'ShipStation not configured' }), { status: 400 });
    }

    const supabase = adminClient();

    // Fetch shipment with full order details
    const { data: shipment, error: fetchErr } = await supabase
      .from('shipments')
      .select(`
        id, shipment_id, weight, shipment_notes,
        orders(
          id, order_id,
          customers(name, email, phone, address, city, state, postal_code, country),
          order_items(quantity, inventory_items(product_title, sku))
        )
      `)
      .eq('id', shipment_id)
      .eq('organization_id', organization_id)
      .single();

    if (fetchErr || !shipment) {
      return new Response(JSON.stringify({ error: 'Shipment not found' }), { status: 404 });
    }

    if (!shipment.weight) {
      return new Response(JSON.stringify({ error: 'Shipment weight required' }), { status: 400 });
    }

    const customer = shipment.orders?.customers;
    if (!customer?.address || !customer?.city || !customer?.state || !customer?.postal_code) {
      return new Response(JSON.stringify({ error: 'Incomplete ship-to address' }), { status: 400 });
    }

    console.log('Creating label for shipment:', shipment_id);

    // Build create label request
    const labelRequest = {
      carrierCode: carrier_code || 'usps',
      serviceCode: service_code || 'usps_priority_mail',
      packageCode: 'package',
      confirmation: 'none',
      shipDate: new Date().toISOString().split('T')[0],
      weight: {
        value: shipment.weight,
        units: 'pounds',
      },
      dimensions: null,
      shipFrom: {
        name: 'deryv Warehouse',
        company: 'deryv',
        street1: '123 Warehouse St', // TODO: Get from organization settings
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90210',
        country: 'US',
        phone: '555-0100',
      },
      shipTo: {
        name: customer.name || 'Customer',
        company: null,
        street1: customer.address,
        street2: null,
        city: customer.city,
        state: customer.state,
        postalCode: customer.postal_code,
        country: customer.country || 'US',
        phone: customer.phone || null,
        residential: true,
      },
      insuranceOptions: null,
      internationalOptions: null,
      advancedOptions: null,
      testLabel: false,
    };

    const response = await fetch('https://ssapi.shipstation.com/orders/createlabelfororder', {
      method: 'POST',
      headers: {
        'Authorization': shipStationAuth(credentials.apiKey, credentials.apiSecret),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(labelRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ShipStation create label error:', errorText);

      // Log error event
      await supabase.from('integration_events').insert({
        organization_id,
        provider: 'shipstation',
        event_type: 'label_creation_failed',
        status: 'error',
        error_message: errorText,
        metadata: { shipment_id },
      });

      return new Response(JSON.stringify({ error: `Failed to create label: ${response.statusText}` }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const labelData = await response.json();
    console.log('Label created successfully:', labelData.trackingNumber);

    // Update shipment with label data
    await supabase.from('shipments').update({
      tracking_number: labelData.trackingNumber,
      carrier: labelData.carrierCode,
      service: labelData.serviceCode,
      label_url: labelData.labelData,
      label_cost: labelData.shipmentCost,
      status: 'LABEL_CREATED',
      config: {
        shipstation_shipment_id: labelData.shipmentId,
        shipstation_label_id: labelData.labelId,
        label_format: labelData.labelFormat || 'pdf',
      },
    }).eq('id', shipment_id);

    // Create activity log
    await supabase.from('activity_log').insert({
      organization_id,
      user_id: caller.id,
      action: `Shipping label created for ${shipment.shipment_id}`,
      entity_type: 'shipments',
      entity_id: shipment_id,
    });

    // Create notification
    await supabase.from('notifications').insert({
      organization_id,
      title: 'Shipping Label Created',
      message: `Label created for shipment ${shipment.shipment_id}. Tracking: ${labelData.trackingNumber}`,
      entity_type: 'shipments',
      entity_id: shipment_id,
      priority: 'medium',
    });

    // Log event
    await supabase.from('integration_events').insert({
      organization_id,
      provider: 'shipstation',
      event_type: 'label_created',
      status: 'success',
      metadata: {
        shipment_id,
        tracking_number: labelData.trackingNumber,
        carrier: labelData.carrierCode,
        cost: labelData.shipmentCost,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      tracking_number: labelData.trackingNumber,
      carrier_code: labelData.carrierCode,
      service_code: labelData.serviceCode,
      label_url: labelData.labelData,
      label_cost: labelData.shipmentCost,
      shipstation_shipment_id: labelData.shipmentId,
      shipstation_label_id: labelData.labelId,
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error: any) {
    console.error('Create label error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Failed to create label' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
