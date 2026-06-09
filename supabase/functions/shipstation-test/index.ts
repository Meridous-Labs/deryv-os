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
    const body = await req.json();
    const { api_key, api_secret } = body;

    if (!api_key || !api_secret) {
      return new Response(JSON.stringify({ error: 'Missing API credentials' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    console.log('Testing ShipStation connection...');

    // Test by fetching stores (lightweight endpoint)
    const response = await fetch('https://ssapi.shipstation.com/stores', {
      method: 'GET',
      headers: {
        'Authorization': shipStationAuth(api_key, api_secret),
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ShipStation test failed:', errorText);
      return new Response(JSON.stringify({
        success: false,
        error: `Authentication failed: ${response.statusText}`
      }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const data = await response.json();
    console.log('ShipStation test successful, stores:', data.length);

    return new Response(JSON.stringify({
      success: true,
      message: 'Connection successful',
      stores: data.length
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error: any) {
    console.error('ShipStation test error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Connection test failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
