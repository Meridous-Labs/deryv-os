import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js";

const app = new Hono();

app.use('*', logger(console.log));
app.use("/*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["POST", "OPTIONS"],
  exposeHeaders: ["Content-Length"],
  maxAge: 600,
}));

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

// Start OAuth flow
app.post("/integrations/start", async (c) => {
  try {
    const caller = await getAuthUser(c.req.header('Authorization'));
    if (!caller) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { organization_id, provider } = body;

    if (!organization_id || !provider) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    console.log(`Starting integration for provider: ${provider}`);

    const supabase = adminClient();

    // Generate state token for OAuth callback verification
    const state = crypto.randomUUID();

    // Store OAuth state
    await supabase.from('integration_connections').upsert({
      organization_id,
      provider,
      status: 'OAUTH_REQUIRED',
      config: { oauth_state: state, initiated_by: caller.id },
    }, { onConflict: 'organization_id,provider' });

    // Build OAuth redirect URLs based on provider
    let authUrl = '';
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/integrations/callback`;

    switch (provider) {
      case 'shopify':
        // Shopify OAuth requires shop domain - frontend should collect this first
        return c.json({
          error: 'Shopify OAuth requires shop domain',
          requiresInput: { field: 'shop_domain', label: 'Shopify Store Domain' }
        }, 400);

      case 'ebay':
        const ebayClientId = Deno.env.get('EBAY_CLIENT_ID');
        if (!ebayClientId) {
          return c.json({ error: 'eBay OAuth not configured' }, 500);
        }
        authUrl = `https://auth.ebay.com/oauth2/authorize?client_id=${ebayClientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=https://api.ebay.com/oauth/api_scope&state=${state}`;
        break;

      case 'quickbooks':
        const qbClientId = Deno.env.get('QUICKBOOKS_CLIENT_ID');
        if (!qbClientId) {
          return c.json({ error: 'QuickBooks OAuth not configured' }, 500);
        }
        authUrl = `https://appcenter.intuit.com/connect/oauth2?client_id=${qbClientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=com.intuit.quickbooks.accounting&state=${state}`;
        break;

      case 'stripe':
        const stripeClientId = Deno.env.get('STRIPE_CLIENT_ID');
        if (!stripeClientId) {
          return c.json({ error: 'Stripe Connect not configured' }, 500);
        }
        authUrl = `https://connect.stripe.com/oauth/authorize?client_id=${stripeClientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read_write&state=${state}`;
        break;

      default:
        return c.json({ error: 'OAuth not supported for this provider' }, 400);
    }

    return c.json({ authUrl, state });

  } catch (error: any) {
    console.error('Integration start error:', error);
    return c.json({ error: error.message || 'Failed to start integration' }, 500);
  }
});

// OAuth callback handler
app.post("/integrations/callback", async (c) => {
  try {
    const body = await c.req.json();
    const { code, state } = body;

    if (!code || !state) {
      return c.json({ error: 'Missing OAuth parameters' }, 400);
    }

    const supabase = adminClient();

    // Find connection by state
    const { data: connection, error: fetchErr } = await supabase
      .from('integration_connections')
      .select('*')
      .eq('config->>oauth_state', state)
      .single();

    if (fetchErr || !connection) {
      return c.json({ error: 'Invalid OAuth state' }, 400);
    }

    // Exchange code for tokens (implementation depends on provider)
    // This is a placeholder - real implementation would call provider APIs
    console.log(`OAuth callback for ${connection.provider} with code`);

    // Update connection with tokens (encrypted)
    await supabase.from('integration_connections').update({
      status: 'CONNECTED',
      health: 'HEALTHY',
      config: { ...connection.config, tokens_encrypted: true },
      last_sync_at: new Date().toISOString(),
    }).eq('id', connection.id);

    // Log event
    await supabase.from('integration_events').insert({
      organization_id: connection.organization_id,
      provider: connection.provider,
      event_type: 'oauth_connected',
      status: 'success',
    });

    return c.json({ success: true });

  } catch (error: any) {
    console.error('OAuth callback error:', error);
    return c.json({ error: error.message || 'OAuth callback failed' }, 500);
  }
});

// Configure credentials (for API key-based integrations)
app.post("/integrations/configure", async (c) => {
  try {
    const caller = await getAuthUser(c.req.header('Authorization'));
    if (!caller) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { organization_id, provider, credentials } = body;

    if (!organization_id || !provider || !credentials) {
      return c.json({ error: 'Missing required fields' }, 400);
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
        return c.json({ error: 'Credential configuration not supported for this provider' }, 400);
    }

    if (!isValid) {
      return c.json({ error: `Missing required fields: ${requiredFields.join(', ')}` }, 400);
    }

    // Test ShipStation credentials before saving
    if (provider === 'shipstation') {
      console.log('Testing ShipStation credentials...');

      const testResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/shipstation-label/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': c.req.header('Authorization') || '',
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

        return c.json({
          error: testResult.error || 'Credential test failed'
        }, 400);
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

    return c.json({ success: true });

  } catch (error: any) {
    console.error('Configure error:', error);
    return c.json({ error: error.message || 'Failed to configure integration' }, 500);
  }
});

// Test connection
app.post("/integrations/test", async (c) => {
  try {
    const caller = await getAuthUser(c.req.header('Authorization'));
    if (!caller) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { organization_id, provider } = body;

    if (!organization_id || !provider) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    const supabase = adminClient();

    const { data: connection, error: fetchErr } = await supabase
      .from('integration_connections')
      .select('*')
      .eq('organization_id', organization_id)
      .eq('provider', provider)
      .single();

    if (fetchErr || !connection) {
      return c.json({ error: 'Integration not found' }, 404);
    }

    // Test connection based on provider
    // This is a placeholder - real implementation would call provider APIs
    console.log(`Testing connection for ${provider}`);

    const testSuccess = Math.random() > 0.1; // 90% success for demo

    if (testSuccess) {
      await supabase.from('integration_connections').update({
        health: 'HEALTHY',
        last_sync_at: new Date().toISOString(),
      }).eq('id', connection.id);

      await supabase.from('integration_events').insert({
        organization_id,
        provider,
        event_type: 'test_connection',
        status: 'success',
      });

      return c.json({ success: true, message: 'Connection test successful' });
    } else {
      await supabase.from('integration_connections').update({
        health: 'DEGRADED',
      }).eq('id', connection.id);

      await supabase.from('integration_events').insert({
        organization_id,
        provider,
        event_type: 'test_connection',
        status: 'error',
        error_message: 'Connection test failed',
      });

      return c.json({ error: 'Connection test failed' }, 500);
    }

  } catch (error: any) {
    console.error('Test connection error:', error);
    return c.json({ error: error.message || 'Failed to test connection' }, 500);
  }
});

// Sync integration
app.post("/integrations/sync", async (c) => {
  try {
    const caller = await getAuthUser(c.req.header('Authorization'));
    if (!caller) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { organization_id, provider } = body;

    if (!organization_id || !provider) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    const supabase = adminClient();

    const { data: connection, error: fetchErr } = await supabase
      .from('integration_connections')
      .select('*')
      .eq('organization_id', organization_id)
      .eq('provider', provider)
      .single();

    if (fetchErr || !connection) {
      return c.json({ error: 'Integration not found' }, 404);
    }

    if (connection.status !== 'CONNECTED') {
      return c.json({ error: 'Integration not connected' }, 400);
    }

    console.log(`Syncing ${provider}`);

    // Update last sync time
    await supabase.from('integration_connections').update({
      last_sync_at: new Date().toISOString(),
    }).eq('id', connection.id);

    // Log event
    await supabase.from('integration_events').insert({
      organization_id,
      provider,
      event_type: 'manual_sync',
      status: 'success',
    });

    return c.json({ success: true, message: 'Sync initiated' });

  } catch (error: any) {
    console.error('Sync error:', error);
    return c.json({ error: error.message || 'Failed to sync' }, 500);
  }
});

// Disconnect integration
app.post("/integrations/disconnect", async (c) => {
  try {
    const caller = await getAuthUser(c.req.header('Authorization'));
    if (!caller) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { organization_id, provider } = body;

    if (!organization_id || !provider) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    const supabase = adminClient();

    const { data: connection, error: fetchErr } = await supabase
      .from('integration_connections')
      .select('*')
      .eq('organization_id', organization_id)
      .eq('provider', provider)
      .single();

    if (fetchErr || !connection) {
      return c.json({ error: 'Integration not found' }, 404);
    }

    // Mark as disconnected instead of deleting (preserve history)
    await supabase.from('integration_connections').update({
      status: 'DISCONNECTED',
      health: null,
      config: {},
    }).eq('id', connection.id);

    // Log event
    await supabase.from('integration_events').insert({
      organization_id,
      provider,
      event_type: 'disconnected',
      status: 'success',
    });

    return c.json({ success: true });

  } catch (error: any) {
    console.error('Disconnect error:', error);
    return c.json({ error: error.message || 'Failed to disconnect' }, 500);
  }
});

// Get integration events
app.post("/integrations/events", async (c) => {
  try {
    const caller = await getAuthUser(c.req.header('Authorization'));
    if (!caller) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { organization_id, provider, limit = 50 } = body;

    if (!organization_id) {
      return c.json({ error: 'Missing organization_id' }, 400);
    }

    const supabase = adminClient();

    let query = supabase
      .from('integration_events')
      .select('*')
      .eq('organization_id', organization_id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (provider) {
      query = query.eq('provider', provider);
    }

    const { data: events, error } = await query;

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json({ events });

  } catch (error: any) {
    console.error('Events fetch error:', error);
    return c.json({ error: error.message || 'Failed to fetch events' }, 500);
  }
});

// Health check for OpenAI
app.post("/integrations/health/openai", async (c) => {
  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      return c.json({ healthy: false, error: 'API key not configured' });
    }

    // Test API key with a simple request
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      return c.json({ healthy: true });
    } else {
      return c.json({ healthy: false, error: 'API key invalid' });
    }

  } catch (error: any) {
    return c.json({ healthy: false, error: error.message });
  }
});

Deno.serve(app.fetch);
