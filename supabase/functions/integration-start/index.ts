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
    const { organization_id, provider, payload } = body;

    if (!organization_id || !provider) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    console.log(`Starting integration for provider: ${provider}`, { organization_id, payload });

    const supabase = adminClient();

    // Generate state token for OAuth callback verification
    const state = crypto.randomUUID();

    // Store OAuth state
    await supabase.from('integration_connections').upsert({
      organization_id,
      provider,
      status: 'OAUTH_REQUIRED',
      config: { oauth_state: state, initiated_by: caller.id, payload },
    }, { onConflict: 'organization_id,provider' });

    // Build OAuth redirect URLs based on provider
    let oauth_url = '';
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/integration-callback`;

    switch (provider) {
      case 'shopify':
        const shopDomain = payload?.shop;
        if (!shopDomain) {
          return new Response(JSON.stringify({
            error: 'Shopify OAuth requires shop domain'
          }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
        }
        const shopifyClientId = Deno.env.get('SHOPIFY_CLIENT_ID');
        if (!shopifyClientId) {
          return new Response(JSON.stringify({ error: 'Shopify OAuth not configured' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
        oauth_url = `https://${shopDomain}/admin/oauth/authorize?client_id=${shopifyClientId}&scope=read_products,write_products,read_orders,write_orders&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
        break;

      case 'ebay':
        const ebayClientId = Deno.env.get('EBAY_CLIENT_ID');
        if (!ebayClientId) {
          return new Response(JSON.stringify({ error: 'eBay OAuth not configured' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
        oauth_url = `https://auth.ebay.com/oauth2/authorize?client_id=${ebayClientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=https://api.ebay.com/oauth/api_scope&state=${state}`;
        break;

      case 'quickbooks':
        const qbClientId = Deno.env.get('QUICKBOOKS_CLIENT_ID');
        if (!qbClientId) {
          return new Response(JSON.stringify({ error: 'QuickBooks OAuth not configured' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
        oauth_url = `https://appcenter.intuit.com/connect/oauth2?client_id=${qbClientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=com.intuit.quickbooks.accounting&state=${state}`;
        break;

      case 'stripe':
        const stripeClientId = Deno.env.get('STRIPE_CLIENT_ID');
        if (!stripeClientId) {
          return new Response(JSON.stringify({ error: 'Stripe Connect not configured' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
        oauth_url = `https://connect.stripe.com/oauth/authorize?client_id=${stripeClientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read_write&state=${state}`;
        break;

      default:
        return new Response(JSON.stringify({ error: 'OAuth not supported for this provider' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

    console.log(`Generated OAuth URL for ${provider}:`, oauth_url);

    return new Response(JSON.stringify({ oauth_url, state }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error: any) {
    console.error('Integration start error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Failed to start integration' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
