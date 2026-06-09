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
    const { organization_id, shipment_id } = body;

    if (!organization_id || !shipment_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    // Get ShipStation credentials
    const credentials = await getShipStationCredentials(organization_id);
    if (!credentials) {
      return new Response(JSON.stringify({ error: 'ShipStation not configured' }), { status: 400 });
    }

    const supabase = adminClient();

    // Fetch shipment with order and customer info
    const { data: shipment, error: fetchErr } = await supabase
      .from('shipments')
      .select('id, weight, orders(id, customers(name, email, phone, address, city, state, postal_code, country))')
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

    console.log('Fetching rates for shipment:', shipment_id);

    // Build rate request
    const rateRequest = {
      carrierCode: null, // Get rates from all carriers
      fromPostalCode: '90210', // TODO: Get from organization settings
      toState: customer.state,
      toCountry: customer.country || 'US',
      toPostalCode: customer.postal_code,
      toCity: customer.city,
      weight: {
        value: shipment.weight,
        units: 'pounds',
      },
      dimensions: null,
      confirmation: 'none',
      residential: true,
    };

    const response = await fetch('https://ssapi.shipstation.com/shipments/getrates', {
      method: 'POST',
      headers: {
        'Authorization': shipStationAuth(credentials.apiKey, credentials.apiSecret),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(rateRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ShipStation rates error:', errorText);
      return new Response(JSON.stringify({ error: `Failed to fetch rates: ${response.statusText}` }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const rates = await response.json();
    console.log('Received rates:', rates.length);

    // Log event
    await supabase.from('integration_events').insert({
      organization_id,
      provider: 'shipstation',
      event_type: 'rate_fetched',
      status: 'success',
      metadata: { shipment_id, rate_count: rates.length },
    });

    return new Response(JSON.stringify({ rates }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error: any) {
    console.error('Get rates error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Failed to fetch rates' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
