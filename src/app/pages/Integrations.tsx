import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FUNCTION_NAME = "integration-configure";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// QuickBooks OAuth credentials (platform-level, registered once by Jai)
const QB_CLIENT_ID = Deno.env.get("QUICKBOOKS_CLIENT_ID") ?? "";
const QB_CLIENT_SECRET = Deno.env.get("QUICKBOOKS_CLIENT_SECRET") ?? "";
const QB_REDIRECT_URI = Deno.env.get("QUICKBOOKS_REDIRECT_URI") ??
  `${SUPABASE_URL}/functions/v1/integration-configure?provider=quickbooks&action=callback`;
const QB_SCOPES = "com.intuit.quickbooks.accounting";

// Intuit discovery document URL — used to resolve OAuth endpoints dynamically
const INTUIT_DISCOVERY_DOC_URL =
  "https://developer.api.intuit.com/.well-known/openid_configuration";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function redirect(url: string) {
  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders, Location: url },
  });
}

async function parseBody(req: Request) {
  const raw = await req.text();
  if (!raw || raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON request body.");
  }
}

function normalizeProvider(provider: unknown) {
  return String(provider || "").trim().toLowerCase();
}

/** Fetch Intuit's discovery document and return the resolved endpoints. */
async function getIntuitEndpoints(): Promise<{
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
}> {
  const res = await fetch(INTUIT_DISCOVERY_DOC_URL);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch Intuit discovery document: ${res.status} ${res.statusText}`
    );
  }
  const doc = await res.json();
  return {
    authorizationEndpoint: doc.authorization_endpoint,
    tokenEndpoint: doc.token_endpoint,
    revocationEndpoint: doc.revocation_endpoint,
  };
}

/** Generate a cryptographically random CSRF state token. */
function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Store CSRF state in Supabase so we can verify it on callback. */
async function saveOAuthState(
  state: string,
  organization_id: string,
  provider: string
) {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min TTL
  const { error } = await supabase.from("integration_oauth_states").upsert(
    {
      state,
      organization_id,
      provider,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    },
    { onConflict: "state" }
  );
  if (error) throw new Error(`Failed to save OAuth state: ${error.message}`);
}

/** Validate and consume a CSRF state token (one-time use). */
async function consumeOAuthState(
  state: string
): Promise<{ organization_id: string; provider: string } | null> {
  const { data, error } = await supabase
    .from("integration_oauth_states")
    .select("organization_id, provider, expires_at")
    .eq("state", state)
    .single();

  if (error || !data) return null;

  // Delete it immediately (one-time use)
  await supabase.from("integration_oauth_states").delete().eq("state", state);

  // Check expiry
  if (new Date(data.expires_at) < new Date()) return null;

  return { organization_id: data.organization_id, provider: data.provider };
}

// ---------------------------------------------------------------------------
// Logging & DB helpers
// ---------------------------------------------------------------------------

async function logEvent(params: {
  organization_id: string;
  provider: string;
  event_type: string;
  status: string;
  payload?: Record<string, unknown>;
  response?: Record<string, unknown>;
  error?: string | null;
  intuit_tid?: string | null;
}) {
  await supabase.from("integration_events").insert({
    organization_id: params.organization_id,
    provider: params.provider,
    event_type: params.event_type,
    status: params.status,
    payload: params.payload ?? {},
    response: {
      ...(params.response ?? {}),
      ...(params.intuit_tid ? { intuit_tid: params.intuit_tid } : {}),
    },
    error: params.error ?? null,
    processed_at: ["COMPLETED", "FAILED"].includes(params.status)
      ? new Date().toISOString()
      : null,
  });
}

async function upsertConnection(params: {
  organization_id: string;
  provider: string;
  status: string;
  auth_type: string;
  account_label?: string | null;
  external_account_id?: string | null;
  encrypted_access_token?: string | null;
  encrypted_refresh_token?: string | null;
  token_expires_at?: string | null;
  scopes?: string[] | null;
  config?: Record<string, unknown>;
  error?: string | null;
}) {
  const { data, error } = await supabase
    .from("integration_connections")
    .upsert(
      {
        organization_id: params.organization_id,
        provider: params.provider,
        status: params.status,
        auth_type: params.auth_type,
        account_label: params.account_label ?? null,
        external_account_id: params.external_account_id ?? null,
        encrypted_access_token: params.encrypted_access_token ?? null,
        encrypted_refresh_token: params.encrypted_refresh_token ?? null,
        token_expires_at: params.token_expires_at ?? null,
        scopes: params.scopes ?? null,
        config: params.config ?? {},
        error: params.error ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,provider" }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to save integration connection: ${error.message}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// QuickBooks OAuth — token exchange with retry + intuit_tid capture
// ---------------------------------------------------------------------------

interface QBTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: string;
  intuit_tid?: string; // captured from response header
}

/**
 * Exchange an auth code or refresh token for QBO tokens.
 * Retries once on transient failures (5xx). Captures intuit_tid header.
 */
async function fetchQBTokens(
  tokenEndpoint: string,
  params: URLSearchParams,
  attempt = 1
): Promise<QBTokenResponse> {
  const credentials = btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`);

  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
    body: params.toString(),
  });

  // Always capture intuit_tid for support/debug purposes
  const intuitTid = res.headers.get("intuit_tid") ?? undefined;

  if (!res.ok) {
    const errorBody = await res.text();

    // Retry once on 5xx transient errors
    if (res.status >= 500 && attempt < 2) {
      console.warn(
        `QB token endpoint returned ${res.status}, retrying... (intuit_tid: ${intuitTid})`
      );
      await new Promise((r) => setTimeout(r, 1000));
      return fetchQBTokens(tokenEndpoint, params, attempt + 1);
    }

    // Surface specific error types
    let errorType = "token_exchange_failed";
    try {
      const parsed = JSON.parse(errorBody);
      if (parsed.error === "invalid_grant") errorType = "invalid_grant";
      if (parsed.error === "invalid_client") errorType = "invalid_client";
    } catch { /* ignore */ }

    throw Object.assign(
      new Error(
        `QB token exchange failed (${res.status}): ${errorBody} [intuit_tid: ${intuitTid}]`
      ),
      { errorType, intuitTid }
    );
  }

  const data = await res.json();
  return { ...data, intuit_tid: intuitTid };
}

// ---------------------------------------------------------------------------
// QuickBooks action handlers
// ---------------------------------------------------------------------------

/**
 * action=connect
 * Generates the Intuit authorization URL and returns it (or redirects).
 * Requires: organization_id in query params or POST body.
 */
async function handleQBConnect(
  organization_id: string,
  redirectToIntuit: boolean
): Promise<Response> {
  if (!QB_CLIENT_ID) {
    return json({ success: false, error: "QUICKBOOKS_CLIENT_ID is not configured." }, 500);
  }

  const { authorizationEndpoint } = await getIntuitEndpoints();
  const state = generateState();
  await saveOAuthState(state, organization_id, "quickbooks");

  const authUrl = new URL(authorizationEndpoint);
  authUrl.searchParams.set("client_id", QB_CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", QB_SCOPES);
  authUrl.searchParams.set("redirect_uri", QB_REDIRECT_URI);
  authUrl.searchParams.set("state", state);

  // Log the connect initiation
  await logEvent({
    organization_id,
    provider: "quickbooks",
    event_type: "oauth_connect_initiated",
    status: "PENDING",
    payload: { scope: QB_SCOPES },
  });

  if (redirectToIntuit) {
    return redirect(authUrl.toString());
  }

  return json({
    success: true,
    provider: "quickbooks",
    action: "connect",
    auth_url: authUrl.toString(),
  });
}

/**
 * action=callback
 * Handles Intuit's redirect after user authorization.
 * Validates CSRF state, exchanges code for tokens, saves to integration_connections.
 */
async function handleQBCallback(url: URL): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const realmId = url.searchParams.get("realmId"); // QBO company ID
  const errorParam = url.searchParams.get("error");

  // User denied access
  if (errorParam) {
    console.error(`QB OAuth error from Intuit: ${errorParam}`);
    return redirect(
      `${Deno.env.get("APP_URL") ?? "https://deryvos.com"}/integrations?error=qb_denied`
    );
  }

  if (!code || !state) {
    return json({ success: false, error: "Missing code or state in callback." }, 400);
  }

  // Validate CSRF state
  const stateData = await consumeOAuthState(state);
  if (!stateData) {
    return json({ success: false, error: "Invalid or expired OAuth state. Possible CSRF attempt." }, 400);
  }

  const { organization_id } = stateData;
  const { tokenEndpoint } = await getIntuitEndpoints();

  let tokens: QBTokenResponse;
  try {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: QB_REDIRECT_URI,
    });
    tokens = await fetchQBTokens(tokenEndpoint, params);
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    const intuitTid = err.intuitTid ?? null;

    await upsertConnection({
      organization_id,
      provider: "quickbooks",
      status: "ERROR",
      auth_type: "oauth2",
      error: message,
    });

    await logEvent({
      organization_id,
      provider: "quickbooks",
      event_type: "oauth_callback",
      status: "FAILED",
      error: message,
      intuit_tid: intuitTid,
    });

    return redirect(
      `${Deno.env.get("APP_URL") ?? "https://deryvos.com"}/integrations?error=qb_token_failed`
    );
  }

  const tokenExpiresAt = new Date(
    Date.now() + tokens.expires_in * 1000
  ).toISOString();

  const connection = await upsertConnection({
    organization_id,
    provider: "quickbooks",
    status: "CONNECTED",
    auth_type: "oauth2",
    account_label: `QuickBooks (${realmId})`,
    external_account_id: realmId,
    encrypted_access_token: tokens.access_token,
    encrypted_refresh_token: tokens.refresh_token,
    token_expires_at: tokenExpiresAt,
    scopes: QB_SCOPES.split(" "),
    config: {
      realm_id: realmId,
      refresh_token_expires_in: tokens.x_refresh_token_expires_in,
      connected_at: new Date().toISOString(),
    },
    error: null,
  });

  await logEvent({
    organization_id,
    provider: "quickbooks",
    event_type: "oauth_callback",
    status: "COMPLETED",
    payload: { realm_id: realmId },
    response: { connection_id: connection.id, status: connection.status },
    intuit_tid: tokens.intuit_tid ?? null,
  });

  return redirect(
    `${Deno.env.get("APP_URL") ?? "https://deryvos.com"}/integrations?connected=quickbooks`
  );
}

/**
 * action=disconnect
 * Revokes QBO tokens via Intuit's revocation endpoint and clears the connection.
 */
async function handleQBDisconnect(organization_id: string): Promise<Response> {
  // Fetch existing connection
  const { data: connection, error: fetchError } = await supabase
    .from("integration_connections")
    .select("encrypted_access_token, encrypted_refresh_token")
    .eq("organization_id", organization_id)
    .eq("provider", "quickbooks")
    .single();

  if (fetchError || !connection) {
    return json({ success: false, error: "No active QuickBooks connection found." }, 404);
  }

  const { revocationEndpoint } = await getIntuitEndpoints();
  const credentials = btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`);

  // Revoke the refresh token (invalidates both tokens)
  if (connection.encrypted_refresh_token) {
    try {
      const res = await fetch(revocationEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
          Accept: "application/json",
        },
        body: new URLSearchParams({
          token: connection.encrypted_refresh_token,
        }).toString(),
      });

      const intuitTid = res.headers.get("intuit_tid") ?? null;

      if (!res.ok) {
        // Log but don't block disconnect — still clear locally
        console.warn(`QB token revocation returned ${res.status} (intuit_tid: ${intuitTid})`);
      }

      await logEvent({
        organization_id,
        provider: "quickbooks",
        event_type: "oauth_disconnect",
        status: res.ok ? "COMPLETED" : "PARTIAL",
        payload: { revocation_status: res.status },
        intuit_tid: intuitTid,
      });
    } catch (err) {
      console.error("QB revocation request failed:", err);
      // Still proceed with local cleanup
    }
  }

  // Clear the connection locally regardless of revocation result
  await upsertConnection({
    organization_id,
    provider: "quickbooks",
    status: "DISCONNECTED",
    auth_type: "oauth2",
    encrypted_access_token: null,
    encrypted_refresh_token: null,
    token_expires_at: null,
    scopes: null,
    error: null,
    config: { disconnected_at: new Date().toISOString() },
  });

  return json({
    success: true,
    provider: "quickbooks",
    action: "disconnect",
    message: "QuickBooks disconnected successfully.",
  });
}

/**
 * action=refresh
 * Proactively refreshes the QBO access token using the stored refresh token.
 * Called before API requests when the access token is near expiry.
 */
async function handleQBRefresh(organization_id: string): Promise<Response> {
  const { data: connection, error: fetchError } = await supabase
    .from("integration_connections")
    .select("encrypted_refresh_token, token_expires_at, config")
    .eq("organization_id", organization_id)
    .eq("provider", "quickbooks")
    .single();

  if (fetchError || !connection) {
    return json({ success: false, error: "No QuickBooks connection found." }, 404);
  }

  if (!connection.encrypted_refresh_token) {
    // Refresh token expired — user must reconnect
    await upsertConnection({
      organization_id,
      provider: "quickbooks",
      status: "RECONNECT_REQUIRED",
      auth_type: "oauth2",
      error: "Refresh token expired. User must reconnect.",
    });

    await logEvent({
      organization_id,
      provider: "quickbooks",
      event_type: "oauth_refresh",
      status: "FAILED",
      error: "No refresh token available. Reconnect required.",
    });

    return json({
      success: false,
      provider: "quickbooks",
      error: "Refresh token expired. Please reconnect QuickBooks.",
      reconnect_required: true,
    }, 401);
  }

  const { tokenEndpoint } = await getIntuitEndpoints();

  let tokens: QBTokenResponse;
  try {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: connection.encrypted_refresh_token,
    });
    tokens = await fetchQBTokens(tokenEndpoint, params);
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    const intuitTid = err.intuitTid ?? null;
    const isInvalidGrant = err.errorType === "invalid_grant";

    // Invalid grant = refresh token expired or revoked — must reconnect
    if (isInvalidGrant) {
      await upsertConnection({
        organization_id,
        provider: "quickbooks",
        status: "RECONNECT_REQUIRED",
        auth_type: "oauth2",
        error: "Invalid grant: refresh token revoked or expired.",
      });
    }

    await logEvent({
      organization_id,
      provider: "quickbooks",
      event_type: "oauth_refresh",
      status: "FAILED",
      error: message,
      intuit_tid: intuitTid,
    });

    return json({
      success: false,
      provider: "quickbooks",
      error: message,
      reconnect_required: isInvalidGrant,
    }, isInvalidGrant ? 401 : 500);
  }

  const tokenExpiresAt = new Date(
    Date.now() + tokens.expires_in * 1000
  ).toISOString();

  const updated = await upsertConnection({
    organization_id,
    provider: "quickbooks",
    status: "CONNECTED",
    auth_type: "oauth2",
    encrypted_access_token: tokens.access_token,
    encrypted_refresh_token: tokens.refresh_token,
    token_expires_at: tokenExpiresAt,
    config: {
      ...(connection.config ?? {}),
      last_refreshed_at: new Date().toISOString(),
    },
    error: null,
  });

  await logEvent({
    organization_id,
    provider: "quickbooks",
    event_type: "oauth_refresh",
    status: "COMPLETED",
    response: { connection_id: updated.id },
    intuit_tid: tokens.intuit_tid ?? null,
  });

  return json({
    success: true,
    provider: "quickbooks",
    action: "refresh",
    token_expires_at: tokenExpiresAt,
  });
}

// ---------------------------------------------------------------------------
// Existing provider handlers (unchanged)
// ---------------------------------------------------------------------------

async function configureShipStation(body: any) {
  const organization_id = body.organization_id;
  const payload = body.payload ?? body.input ?? {};

  const credentials = body.credentials ?? {};
  const apiKey =
    payload.api_key || payload.apiKey || body.api_key || body.apiKey || credentials.api_key || credentials.apiKey;
  const apiSecret =
    payload.api_secret || payload.apiSecret || body.api_secret || body.apiSecret || credentials.api_secret || credentials.apiSecret;
  const accountLabel =
    payload.account_label || payload.accountLabel || body.account_label || "ShipStation";

  if (!apiKey || !apiSecret) {
    return json(
      {
        success: false,
        provider: "shipstation",
        status: "CREDENTIALS_NEEDED",
        error: "ShipStation API key and API secret are required.",
      },
      400
    );
  }

  const connection = await upsertConnection({
    organization_id,
    provider: "shipstation",
    status: "CONNECTED",
    auth_type: "api_key",
    account_label: accountLabel,
    encrypted_access_token: String(apiKey),
    encrypted_refresh_token: String(apiSecret),
    config: {
      credential_type: "shipstation_api_key_secret",
      configured_at: new Date().toISOString(),
    },
    error: null,
  });

  await logEvent({
    organization_id,
    provider: "shipstation",
    event_type: "integration_configure",
    status: "COMPLETED",
    payload: {
      provider: "shipstation",
      account_label: accountLabel,
      api_key_present: true,
      api_secret_present: true,
    },
    response: { connection_id: connection.id, status: connection.status },
  });

  return json({
    success: true,
    provider: "shipstation",
    status: connection.status,
    message: "ShipStation credentials saved. Run Test Connection to verify.",
    connection,
  });
}

async function configureA2XGuidance(body: any) {
  const organization_id = body.organization_id;
  const payload = body.payload ?? body.input ?? {};

  const connection = await upsertConnection({
    organization_id,
    provider: "a2x",
    status: "CONFIGURED",
    auth_type: "setup_guide",
    account_label: payload.account_label || "A2X Setup Guide",
    config: {
      setup_guide_acknowledged: true,
      notes: payload.notes || null,
      configured_at: new Date().toISOString(),
    },
    error: null,
  });

  await logEvent({
    organization_id,
    provider: "a2x",
    event_type: "a2x_setup_guide_configured",
    status: "COMPLETED",
    payload: { notes: payload.notes || null },
    response: { connection_id: connection.id, status: connection.status },
  });

  return json({
    success: true,
    provider: "a2x",
    status: connection.status,
    message: "A2X setup guidance marked as configured.",
    connection,
  });
}

async function configureGeneric(body: any, provider: string) {
  const organization_id = body.organization_id;
  const payload = body.payload ?? body.input ?? {};

  const connection = await upsertConnection({
    organization_id,
    provider,
    status: "CREDENTIALS_NEEDED",
    auth_type: "config",
    account_label: payload.account_label || provider,
    config: { ...payload, configured_at: new Date().toISOString() },
    error: null,
  });

  await logEvent({
    organization_id,
    provider,
    event_type: "integration_configure",
    status: "COMPLETED",
    payload: { provider, config_keys: Object.keys(payload || {}) },
    response: { connection_id: connection.id, status: connection.status },
  });

  return json({
    success: true,
    provider,
    status: connection.status,
    message: `${provider} configuration saved.`,
    connection,
  });
}

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method === "GET") {
      // Health check
      const url = new URL(req.url);
      const provider = normalizeProvider(url.searchParams.get("provider"));
      const action = url.searchParams.get("action");

      // QuickBooks OAuth callback arrives as a GET redirect from Intuit
      if (provider === "quickbooks" && action === "callback") {
        return await handleQBCallback(url);
      }

      return json({ success: true, service: FUNCTION_NAME, status: "healthy" });
    }

    if (req.method !== "POST") {
      return json({ success: false, error: "Method not allowed. Use POST." }, 405);
    }

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json(
        { success: false, error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing." },
        500
      );
    }

    const body = await parseBody(req);
    const url = new URL(req.url);

    // Provider and action can come from query params (OAuth redirects) or body (API calls)
    const provider = normalizeProvider(
      body.provider || url.searchParams.get("provider")
    );
    const action = body.action || url.searchParams.get("action");
    const organization_id = body.organization_id || url.searchParams.get("organization_id");

    if (!organization_id && provider !== "quickbooks") {
      return json({ success: false, error: "organization_id is required." }, 400);
    }

    if (!provider) {
      return json({ success: false, error: "provider is required." }, 400);
    }

    // Blocked providers
    if (provider === "finaloop") {
      return json({ success: false, error: "Finaloop is not supported." }, 400);
    }
    if (provider === "openai") {
      return json(
        { success: false, error: "OpenAI is a platform service and is not user-configurable." },
        400
      );
    }
    if (["make", "gusto", "melio"].includes(provider)) {
      return json({ success: false, error: `${provider} is not part of BETA integrations.` }, 400);
    }

    // QuickBooks OAuth actions
    if (provider === "quickbooks") {
      if (!QB_CLIENT_ID || !QB_CLIENT_SECRET) {
        return json(
          { success: false, error: "QuickBooks OAuth credentials are not configured." },
          500
        );
      }

      switch (action) {
        case "connect":
          // redirectToIntuit=true when called from the browser directly
          return await handleQBConnect(organization_id!, body.redirect === true);
        case "callback":
          return await handleQBCallback(url);
        case "disconnect":
          return await handleQBDisconnect(organization_id!);
        case "refresh":
          return await handleQBRefresh(organization_id!);
        default:
          return json(
            {
              success: false,
              error: `Unknown QuickBooks action: "${action}". Valid actions: connect, callback, disconnect, refresh.`,
            },
            400
          );
      }
    }

    // Existing providers
    if (provider === "shipstation") return await configureShipStation(body);
    if (provider === "a2x") return await configureA2XGuidance(body);

    return await configureGeneric(body, provider);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown integration-configure error.";
    console.error("integration-configure error:", message);
    return json({ success: false, error: message }, 500);
  }
});