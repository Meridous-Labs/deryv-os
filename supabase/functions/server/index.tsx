import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js";

const app = new Hono();

app.use('*', logger(console.log));
app.use("/*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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

async function ensureBuckets() {
  const supabase = adminClient();
  const bucketNames = [
    'make-1b9ff536-manifests',
    'make-1b9ff536-invoices',
    'make-1b9ff536-inventory-photos',
    'make-1b9ff536-shipping-labels',
    'make-1b9ff536-documents',
    'make-1b9ff536-reports',
    'make-1b9ff536-supply-invoices',
  ];
  const publicBucketNames = [
    'organization-assets',
  ];
  const { data: existing } = await supabase.storage.listBuckets();
  const existingNames = new Set((existing || []).map((b: any) => b.name));
  for (const name of bucketNames) {
    if (!existingNames.has(name)) {
      await supabase.storage.createBucket(name, { public: false });
    }
  }
  for (const name of publicBucketNames) {
    if (!existingNames.has(name)) {
      await supabase.storage.createBucket(name, { public: true });
    }
  }
}

// Ensure buckets exist on startup
ensureBuckets().catch(e => console.log('Bucket setup error:', e));

// Health check
app.get("/make-server-1b9ff536/health", (c) => {
  return c.json({ status: "ok" });
});

// Create user (admin-only operation)
app.post("/make-server-1b9ff536/auth/create-user", async (c) => {
  try {
    const caller = await getAuthUser(c.req.header('Authorization'));
    if (!caller) return c.json({ error: 'Unauthorized: must be authenticated' }, 401);

    const body = await c.req.json();
    const { email, password, name, role, organizationId } = body;

    if (!email || !password || !organizationId || !role) {
      return c.json({ error: 'Missing required fields: email, password, organizationId, role' }, 400);
    }

    const supabase = adminClient();

    // Verify caller is an admin of this org
    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', caller.id)
      .single();

    if (!membership || membership.role !== 'admin') {
      return c.json({ error: 'Forbidden: only admins can create users' }, 403);
    }

    // Create the auth user
    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name: name ?? email.split('@')[0] },
      email_confirm: true,
    });

    if (createErr) {
      return c.json({ error: `Failed to create user: ${createErr.message}` }, 400);
    }

    // Add to org_members
    const { error: memberErr } = await supabase
      .from('organization_members')
      .insert({
        organization_id: organizationId,
        user_id: newUser.user.id,
        role,
      });

    if (memberErr) {
      return c.json({ error: `User created but org membership failed: ${memberErr.message}` }, 500);
    }

    return c.json({ success: true, userId: newUser.user.id });
  } catch (e: any) {
    console.log('create-user error:', e);
    return c.json({ error: `Unexpected error: ${e.message}` }, 500);
  }
});

// Get signed URL for private file
app.get("/make-server-1b9ff536/storage/sign", async (c) => {
  try {
    const caller = await getAuthUser(c.req.header('Authorization'));
    if (!caller) return c.json({ error: 'Unauthorized' }, 401);

    const bucket = c.req.query('bucket');
    const path = c.req.query('path');

    if (!bucket || !path) {
      return c.json({ error: 'Missing bucket or path query params' }, 400);
    }

    const supabase = adminClient();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600); // 1 hour

    if (error) return c.json({ error: `Storage error: ${error.message}` }, 500);

    return c.json({ signedUrl: data.signedUrl });
  } catch (e: any) {
    return c.json({ error: `Unexpected error: ${e.message}` }, 500);
  }
});

// Get upload URL for private bucket
app.post("/make-server-1b9ff536/storage/upload-url", async (c) => {
  try {
    const caller = await getAuthUser(c.req.header('Authorization'));
    if (!caller) return c.json({ error: 'Unauthorized' }, 401);

    const { bucket, path, contentType } = await c.req.json();
    if (!bucket || !path) return c.json({ error: 'Missing bucket or path' }, 400);

    const supabase = adminClient();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(path);

    if (error) return c.json({ error: `Storage error: ${error.message}` }, 500);

    return c.json({ signedUrl: data.signedUrl, token: data.token, path: data.path });
  } catch (e: any) {
    return c.json({ error: `Unexpected error: ${e.message}` }, 500);
  }
});

// List files in a bucket folder
app.get("/make-server-1b9ff536/storage/list", async (c) => {
  try {
    const caller = await getAuthUser(c.req.header('Authorization'));
    if (!caller) return c.json({ error: 'Unauthorized' }, 401);

    const bucket = c.req.query('bucket');
    const folder = c.req.query('folder') ?? '';

    if (!bucket) return c.json({ error: 'Missing bucket param' }, 400);

    const supabase = adminClient();
    const { data, error } = await supabase.storage.from(bucket).list(folder);
    if (error) return c.json({ error: `Storage error: ${error.message}` }, 500);

    return c.json({ files: data });
  } catch (e: any) {
    return c.json({ error: `Unexpected error: ${e.message}` }, 500);
  }
});

// Upload organization logo to public organization-assets bucket
app.post("/make-server-1b9ff536/branding/upload-logo", async (c) => {
  try {
    const caller = await getAuthUser(c.req.header('Authorization'));
    if (!caller) return c.json({ error: 'Unauthorized: must be authenticated' }, 401);

    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    const orgId = formData.get('orgId') as string | null;

    if (!file || !orgId) return c.json({ error: 'Missing file or orgId' }, 400);

    const supabase = adminClient();

    // Verify caller is admin of this org
    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', caller.id)
      .single();

    if (!membership || membership.role !== 'admin') {
      return c.json({ error: 'Forbidden: only admins can update organization branding' }, 403);
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
    const path = `${orgId}/logo.${ext}`;
    const bytes = await file.arrayBuffer();

    const { error: uploadErr } = await supabase.storage
      .from('organization-assets')
      .upload(path, bytes, {
        contentType: file.type || 'image/png',
        upsert: true,
      });

    if (uploadErr) {
      return c.json({ error: `Upload failed: ${uploadErr.message}` }, 500);
    }

    const { data: urlData } = supabase.storage
      .from('organization-assets')
      .getPublicUrl(path);

    const publicUrl = urlData.publicUrl;

    // Persist the URL to organizations table
    const { error: updateErr } = await supabase
      .from('organizations')
      .update({ logo_url: publicUrl })
      .eq('id', orgId);

    if (updateErr) {
      console.log('org logo_url update error:', updateErr);
    }

    return c.json({ public_url: publicUrl });
  } catch (e: any) {
    console.log('upload-logo error:', e);
    return c.json({ error: `Unexpected error: ${e.message}` }, 500);
  }
});

Deno.serve(app.fetch);
