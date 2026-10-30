import { getAdminServices } from './firebaseAdmin.js';

export function sendJson(res, status, body, { cacheControl = 'no-store' } = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  res.end(JSON.stringify(body));
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  sendJson(res, 405, { error: 'Method not allowed.' });
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') {
    if (Buffer.byteLength(JSON.stringify(req.body), 'utf8') > 16_000) {
      throw Object.assign(new Error('Request is too large.'), { status: 413 });
    }
    return req.body;
  }
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > 16_000) {
      throw Object.assign(new Error('Request is too large.'), { status: 413 });
    }
    try { return JSON.parse(req.body); }
    catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); }
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw, 'utf8') > 16_000) {
      throw Object.assign(new Error('Request is too large.'), { status: 413 });
    }
  }
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); }
}

export async function requireVerifiedUser(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Sign in with a verified email to continue.'), { status: 401 });

  const { auth } = getAdminServices();
  let decoded;
  try {
    decoded = await auth.verifyIdToken(match[1], true);
  } catch {
    throw Object.assign(new Error('Your sign-in expired. Sign in again to continue.'), { status: 401 });
  }
  if (decoded.email_verified !== true) {
    throw Object.assign(new Error('Verify your email before using points or creating markets.'), { status: 403 });
  }

  const allowedEmails = (process.env.PHILOMARKET_ALLOWED_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const isHosted = Boolean(process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'development');
  if (isHosted && allowedEmails.length === 0) {
    throw Object.assign(new Error('The club email allowlist is not configured.'), { status: 503 });
  }
  const email = String(decoded.email || '').trim().toLowerCase();
  if (allowedEmails.length > 0 && !allowedEmails.includes('*') && !allowedEmails.includes(email)) {
    throw Object.assign(new Error('This verified email is not on the Philomarket club allowlist.'), { status: 403 });
  }
  return decoded;
}

export function handleApiError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  if (status >= 500) console.error('Philomarket API error:', error?.message || 'Unknown error');
  sendJson(res, status, {
    error: status >= 500 ? 'The market service is temporarily unavailable.' : error.message,
  });
}

export function makeUserRef(db, uid) {
  return db.collection('users').doc(uid);
}

export function profileFrom(uid, email, data) {
  return {
    uid,
    email,
    points: data.points,
    marketsCreated: data.marketsCreated || 0,
  };
}
