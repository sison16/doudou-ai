const fallbackOrigins = [
  "https://sison16.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

function readKeyDictionary(name: string): Record<string, string> {
  try {
    const value = Deno.env.get(name);
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

const publishableKeys = readKeyDictionary("SUPABASE_PUBLISHABLE_KEYS");
const secretKeys = readKeyDictionary("SUPABASE_SECRET_KEYS");
const publishableKey = publishableKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const secretKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const projectUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
const allowedOrigins = new Set([
  ...fallbackOrigins,
  ...(Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
]);

function responseHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "apikey, content-type");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return headers;
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
}

function adminHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    apikey: secretKey,
    "Content-Type": "application/json",
  };
  // Legacy service_role keys are JWTs and need a bearer header. New sb_secret keys must be sent only as apikey.
  if (secretKey.startsWith("eyJ")) headers.Authorization = `Bearer ${secretKey}`;
  return headers;
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function privateBucketKey(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clientAddress(request: Request): string {
  const cloudflareAddress = request.headers.get("cf-connecting-ip");
  if (cloudflareAddress) return cloudflareAddress;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",").map((part) => part.trim()).filter(Boolean).at(-1) ?? "unknown";
  return "unknown";
}

async function checkRateLimit(
  action: string,
  request: Request,
  maxAttempts: number,
  windowSeconds: number,
): Promise<boolean> {
  const bucketKey = await privateBucketKey(`${action}:${clientAddress(request)}`);
  const response = await fetch(`${projectUrl}/rest/v1/rpc/consume_username_auth_rate_limit`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      p_bucket_key: bucketKey,
      p_max_attempts: maxAttempts,
      p_window_seconds: windowSeconds,
    }),
  });
  if (!response.ok) throw new Error("rate_limit_unavailable");
  return await response.json() === true;
}

async function internalEmail(username: string): Promise<string> {
  const canonical = username.normalize("NFKC").trim().toLowerCase();
  return `${await digest(canonical)}@accounts.doudou-ai.invalid`;
}

async function handleRequest(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins.has(origin)) return jsonResponse({ error: "此来源未获准访问。" }, 403, origin);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(origin) });
  if (request.method !== "POST") return jsonResponse({ error: "仅支持 POST 请求。" }, 405, origin);

  if (!publishableKey || !secretKey || !projectUrl) {
    return jsonResponse({ error: "Supabase 服务配置不完整。" }, 503, origin);
  }
  if (request.headers.get("apikey") !== publishableKey) {
    return jsonResponse({ error: "Supabase 公钥无效。" }, 401, origin);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 8192) return jsonResponse({ error: "请求内容过大。" }, 413, origin);

  let body: { action?: unknown; username?: unknown; password?: unknown };
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).length > 8192) return jsonResponse({ error: "请求内容过大。" }, 413, origin);
    body = JSON.parse(rawBody);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ error: "请求格式无效。" }, 400, origin);
    }
  } catch {
    return jsonResponse({ error: "请求格式无效。" }, 400, origin);
  }

  const action = body.action;
  const username = typeof body.username === "string" ? body.username.normalize("NFKC").trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (action !== "login" && action !== "register") return jsonResponse({ error: "请求操作无效。" }, 400, origin);
  if (!username || [...username].length > 64 || /[\u0000-\u001f\u007f]/.test(username) || !password || password.length > 256) {
    return jsonResponse({ error: "用户名或密码格式无效。" }, 400, origin);
  }

  try {
    const limit = action === "register"
      ? await checkRateLimit("register", request, 5, 3600)
      : await checkRateLimit("login", request, 12, 900);
    if (!limit) return jsonResponse({ error: "尝试次数过多，请稍后再试。" }, 429, origin);
  } catch {
    return jsonResponse({ error: "账号服务暂时不可用，请稍后再试。" }, 503, origin);
  }

  const email = await internalEmail(username);
  if (action === "register") {
    let upstream: Response;
    try {
      upstream = await fetch(`${projectUrl}/auth/v1/admin/users`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          user_metadata: { username },
        }),
      });
    } catch {
      return jsonResponse({ error: "注册服务暂时不可用，请稍后再试。" }, 503, origin);
    }
    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : 400;
      return jsonResponse({ error: "创建账户失败；请更换用户名，或检查项目的密码规则。" }, status, origin);
    }
    return jsonResponse({ created: true }, 201, origin);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${projectUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return jsonResponse({ error: "登录服务暂时不可用，请稍后再试。" }, 503, origin);
  }
  if (!upstream.ok) return jsonResponse({ error: "用户名或密码不正确。" }, 401, origin);

  const auth = await upstream.json();
  const { access_token, refresh_token, token_type, expires_in, expires_at, user } = auth;
  // Only a verified Auth response supplies the user ID and successful login time.
  // The RPC is callable solely by service_role; clients cannot assign badges.
  let membership;
  try {
    if (!user?.id || !user?.last_sign_in_at) throw new Error("missing_login_identity");
    const recorded = await fetch(`${projectUrl}/rest/v1/rpc/record_username_login`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ p_user_id: user.id, p_login_at: user.last_sign_in_at }),
      signal: AbortSignal.timeout(10000),
    });
    if (!recorded.ok) throw new Error("membership_unavailable");
    membership = await recorded.json();
    if (!membership || typeof membership.is_beta !== "boolean" || typeof membership.is_admin !== "boolean") {
      throw new Error("invalid_membership");
    }
  } catch {
    return jsonResponse({ error: "账户标记暂时无法保存，请稍后重新登录。" }, 503, origin);
  }
  return jsonResponse({
    user,
    membership,
    session: { access_token, refresh_token, token_type, expires_in, expires_at, user },
  }, 200, origin);
}

Deno.serve((request: Request) => handleRequest(request));
