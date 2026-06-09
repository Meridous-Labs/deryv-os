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

async function callOpenAI(messages: any[], model = 'gpt-4o-mini') {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  return await response.json();
}

// Listing Draft Generator
app.post("/ai-ops/generate-listing", async (c) => {
  try {
    const caller = await getAuthUser(c.req.header('Authorization'));
    if (!caller) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { organization_id, entity_id, input } = body;

    if (!organization_id || !entity_id || !input) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    console.log('Generate Listing - Received Input:', input);

    const supabase = adminClient();

    // Use the inventory item data sent from frontend
    const item = input;

    // Build context for AI using ONLY the data from the input
    const context = {
      product_title: item.product_title,
      brand: item.brand,
      model: item.model,
      category: item.category,
      condition: item.condition,
      sku: item.sku,
      upc: item.upc,
      serial_number: item.serial_number,
      msrp: item.msrp,
      weighted_acquisition_cost: item.weighted_acquisition_cost,
      component_cost: item.component_cost,
      supply_cost: item.supply_cost,
      total_cost_basis: item.total_cost_basis,
      notes: item.notes,
    };

    const messages = [
      {
        role: 'system',
        content: 'You are a marketplace listing optimization assistant. Generate compelling, accurate product listings for eBay. Return ONLY valid JSON with no markdown formatting.'
      },
      {
        role: 'user',
        content: `Generate an optimized eBay listing for this item:\n\n${JSON.stringify(context, null, 2)}\n\nReturn JSON with: title (80 chars max), subtitle (55 chars max), description (HTML formatted), item_specifics (object with relevant specs), recommended_price (number), confidence (0-1), missing_data (array of missing fields that would improve the listing).`
      }
    ];

    const aiResponse = await callOpenAI(messages);
    const content = aiResponse.choices[0].message.content;

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      // Try to extract JSON from markdown code blocks
      const match = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      result = match ? JSON.parse(match[1]) : { error: 'Failed to parse AI response' };
    }

    // Record AI run
    await supabase.from('ai_runs').insert({
      organization_id,
      user_id: caller.id,
      run_type: 'listing_generator',
      entity_type: 'inventory_items',
      entity_id: entity_id,
      input: context,
      output: result,
      status: 'completed',
    });

    return c.json(result);

  } catch (error: any) {
    console.error('Listing generation error:', error);
    return c.json({ error: error.message || 'Failed to generate listing' }, 500);
  }
});

// Manifest Review Assistant
app.post("/ai-ops/review-manifest", async (c) => {
  try {
    const caller = await getAuthUser(c.req.header('Authorization'));
    if (!caller) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { organization_id, entity_id, input } = body;

    if (!organization_id || !entity_id) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    const supabase = adminClient();

    // Fetch manifest import
    const { data: manifest, error: fetchErr } = await supabase
      .from('manifest_imports')
      .select('*')
      .eq('id', entity_id)
      .eq('organization_id', organization_id)
      .single();

    if (fetchErr || !manifest) {
      return c.json({ error: 'Manifest import not found' }, 404);
    }

    const messages = [
      {
        role: 'system',
        content: 'You are a data quality analyst for inventory manifests. Analyze the manifest data and identify issues, missing data, and suggested corrections. Return ONLY valid JSON.'
      },
      {
        role: 'user',
        content: `Analyze this manifest:\n\nNormalized Items:\n${JSON.stringify(manifest.normalized_items, null, 2)}\n\nErrors:\n${JSON.stringify(manifest.errors, null, 2)}\n\nReturn JSON with: rows_needing_review (array of row indices), missing_msrp (array of items missing MSRP), likely_brand_mapping (object mapping unclear brands to suggestions), likely_title_issues (array of problematic titles), suggested_corrections (array of {row, field, current, suggested, reason}).`
      }
    ];

    const aiResponse = await callOpenAI(messages);
    const content = aiResponse.choices[0].message.content;

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      const match = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      result = match ? JSON.parse(match[1]) : { error: 'Failed to parse AI response' };
    }

    // Record AI run
    await supabase.from('ai_runs').insert({
      organization_id,
      user_id: caller.id,
      run_type: 'manifest_review',
      entity_type: 'manifest_imports',
      entity_id: entity_id,
      input: { normalized_items: manifest.normalized_items, errors: manifest.errors },
      output: result,
      status: 'completed',
    });

    return c.json(result);

  } catch (error: any) {
    console.error('Manifest review error:', error);
    return c.json({ error: error.message || 'Failed to review manifest' }, 500);
  }
});

// Pricing Assistant
app.post("/ai-ops/suggest-pricing", async (c) => {
  try {
    const caller = await getAuthUser(c.req.header('Authorization'));
    if (!caller) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { organization_id, entity_id, input } = body;

    if (!organization_id || !entity_id || !input) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    console.log('Suggest Pricing - Received Input:', input);

    const supabase = adminClient();

    // Use the inventory item data sent from frontend
    const item = input;

    const context = {
      product_title: item.product_title,
      category: item.category,
      condition: item.condition,
      sku: item.sku,
      upc: item.upc,
      msrp: item.msrp,
      weighted_acquisition_cost: item.weighted_acquisition_cost,
      component_cost: item.component_cost,
      supply_cost: item.supply_cost,
      total_cost_basis: item.total_cost_basis,
    };

    const messages = [
      {
        role: 'system',
        content: 'You are a pricing analyst for liquidation inventory. Calculate optimal pricing considering costs, condition, and market value. Return ONLY valid JSON.'
      },
      {
        role: 'user',
        content: `Suggest pricing for this item:\n\n${JSON.stringify(context, null, 2)}\n\nReturn JSON with: recommended_price (number), minimum_profitable_price (number), rationale (string explaining the pricing strategy), missing_inputs (array of cost fields that are missing and would improve accuracy).`
      }
    ];

    const aiResponse = await callOpenAI(messages);
    const content = aiResponse.choices[0].message.content;

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      const match = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      result = match ? JSON.parse(match[1]) : { error: 'Failed to parse AI response' };
    }

    // Record AI run
    await supabase.from('ai_runs').insert({
      organization_id,
      user_id: caller.id,
      run_type: 'pricing_assistant',
      entity_type: 'inventory_items',
      entity_id: entity_id,
      input: context,
      output: result,
      status: 'completed',
    });

    return c.json(result);

  } catch (error: any) {
    console.error('Pricing suggestion error:', error);
    return c.json({ error: error.message || 'Failed to suggest pricing' }, 500);
  }
});

// Operational Chat
app.post("/ai-ops/chat", async (c) => {
  try {
    const caller = await getAuthUser(c.req.header('Authorization'));
    if (!caller) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { organization_id, input } = body;

    if (!organization_id || !input?.message) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    const message = input.message;

    const supabase = adminClient();

    // Fetch operational context
    const [
      lotsResult,
      itemsResult,
      ordersResult,
      listingsResult,
      shipmentsResult,
      returnsResult,
    ] = await Promise.all([
      supabase.from('lots').select('id, status').eq('organization_id', organization_id),
      supabase.from('inventory_items').select('id, status').eq('organization_id', organization_id),
      supabase.from('orders').select('id, status, total_amount').eq('organization_id', organization_id),
      supabase.from('marketplace_listings').select('id, status, sync_status').eq('organization_id', organization_id),
      supabase.from('shipments').select('id, status').eq('organization_id', organization_id),
      supabase.from('returns').select('id, status').eq('organization_id', organization_id),
    ]);

    const operationalData = {
      lots: {
        total: lotsResult.data?.length || 0,
        processing: lotsResult.data?.filter(l => l.status === 'PROCESSING').length || 0,
      },
      inventory: {
        total: itemsResult.data?.length || 0,
        active: itemsResult.data?.filter(i => i.status === 'ACTIVE').length || 0,
        listing: itemsResult.data?.filter(i => i.status === 'LISTING').length || 0,
      },
      orders: {
        total: ordersResult.data?.length || 0,
        open: ordersResult.data?.filter(o => o.status === 'OPEN').length || 0,
        revenue: ordersResult.data?.reduce((sum, o) => sum + Number(o.total_amount || 0), 0) || 0,
      },
      listings: {
        total: listingsResult.data?.length || 0,
        active: listingsResult.data?.filter(l => l.status === 'ACTIVE').length || 0,
        errors: listingsResult.data?.filter(l => l.sync_status === 'ERROR').length || 0,
      },
      shipments: {
        total: shipmentsResult.data?.length || 0,
        in_transit: shipmentsResult.data?.filter(s => s.status === 'IN_TRANSIT').length || 0,
      },
      returns: {
        total: returnsResult.data?.length || 0,
        pending: returnsResult.data?.filter(r => r.status === 'PENDING').length || 0,
      },
    };

    const messages = [
      {
        role: 'system',
        content: `You are an AI operations assistant for a liquidation/resale business. Answer questions about operations using the provided data. If asked to take action, suggest which page to navigate to but DO NOT execute changes. Be concise and helpful. Return ONLY valid JSON with: response (string), suggested_action (optional object with {type: 'navigate', path: string, description: string}).`
      },
      {
        role: 'user',
        content: `Current operations data:\n${JSON.stringify(operationalData, null, 2)}\n\nUser question: ${message}`
      }
    ];

    const aiResponse = await callOpenAI(messages, 'gpt-4o-mini');
    const content = aiResponse.choices[0].message.content;

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      const match = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      result = match ? JSON.parse(match[1]) : { response: content };
    }

    // Record AI run
    await supabase.from('ai_runs').insert({
      organization_id,
      user_id: caller.id,
      run_type: 'operational_chat',
      entity_type: null,
      entity_id: null,
      input: { message, operational_data: operationalData },
      output: result,
      status: 'completed',
    });

    return c.json(result);

  } catch (error: any) {
    console.error('Chat error:', error);
    return c.json({ error: error.message || 'Failed to process chat' }, 500);
  }
});

// Get AI runs history
app.post("/ai-ops/runs", async (c) => {
  try {
    const caller = await getAuthUser(c.req.header('Authorization'));
    if (!caller) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { organization_id, limit = 50 } = body;

    if (!organization_id) {
      return c.json({ error: 'Missing organization_id' }, 400);
    }

    const supabase = adminClient();

    const { data: runs, error } = await supabase
      .from('ai_runs')
      .select('*')
      .eq('organization_id', organization_id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json({ runs });

  } catch (error: any) {
    console.error('Runs fetch error:', error);
    return c.json({ error: error.message || 'Failed to fetch runs' }, 500);
  }
});

Deno.serve(app.fetch);
