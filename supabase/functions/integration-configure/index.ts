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
    const { organization_id, provider, credentials } = body;

    if (!organization_id || !provider || !credentials) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    console.log(`Configuring credentials for provider: ${provider}`);

    const supabase = adminClient();

    // Validate credentials format based on provider
    let isValid = false;
    let requiredFields: string[] = [];

    switch (provider) {
      case 'shipstation':
        requiredFields = ['api_key', 'api_secret'];
        isValid = requiredFields.every(f => credentials[f]);
        break;

      case 'openai':
        requiredFields = ['api_key'];
        isValid = requiredFields.every(f => credentials[f]);
        break;

      case 'make':
        requiredFields = ['webhook_url', 'webhook_secret'];
        isValid = requiredFields.every(f => credentials[f]);
        break;

      default:
        return new Response(JSON.stringify({ error: 'Credential configuration not supported for this provider' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

    if (!isValid) {
      return new Response(JSON.stringify({ error: `Missing required fields: ${requiredFields.join(', ')}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Test ShipStation credentials before saving
    if (provider === 'shipstation') {
      console.log('Testing ShipStation credentials...');

      const testResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/shipstation-test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': req.headers.get('Authorization') || '',
        },
        body: JSON.stringify({
          api_key: credentials.api_key,
          api_secret: credentials.api_secret,
        }),
      });

      const testResult = await testResponse.json();

      if (!testResult.success) {
        console.error('ShipStation test failed:', testResult.error);

        // Save with ERROR status
        await supabase.from('integration_connections').upsert({
          organization_id,
          provider,
          status: 'ERROR',
          health: 'DEGRADED',
          config: { test_error: testResult.error },
          last_sync_at: null,
        }, { onConflict: 'organization_id,provider' });

        return new Response(JSON.stringify({
          error: testResult.error || 'Credential test failed'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      console.log('ShipStation test successful');
    }

    // Store credentials (in production, use proper encryption)
    await supabase.from('integration_connections').upsert({
      organization_id,
      provider,
      status: 'CONNECTED',
      health: 'HEALTHY',
      config: { ...credentials, configured_by: caller.id },
      last_sync_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,provider' });

    // Log event
    await supabase.from('integration_events').insert({
      organization_id,
      provider,
      event_type: 'credentials_configured',
      status: 'success',
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error: any) {
    console.error('Configure error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Failed to configure integration' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
