// Demo identity + role-based access control.
//   AUTH_MODE=demo (default)  local signed tokens for synthetic demo users.
//   AUTH_MODE=firebase        verifies Firebase Authentication ID tokens with firebase-admin (optional
//                             dependency; roles come from a custom claim). Written for the cloud
//                             deployment, NOT exercised by this repository's tests.
// In both modes the role -> permission matrix below is the single source of truth.
import crypto from 'node:crypto';
import { HttpError } from './engine/util.js';

export const ROLES = ['agent', 'pricing_analyst', 'pricing_approver', 'admin', 'api_client'];

const ALL = ROLES;
const WORKBENCH = ['pricing_analyst', 'pricing_approver', 'admin'];
export const PERMISSIONS = {
  'quote:create': ALL,
  'quote:pin': ['pricing_analyst', 'pricing_approver', 'admin', 'api_client'],
  'submission:write': ['agent', 'pricing_analyst', 'pricing_approver', 'admin'],
  'config:read': ALL,
  'config:edit': ['pricing_analyst', 'admin'],
  'config:validate': [...WORKBENCH, 'api_client'],
  'config:approve': ['pricing_approver', 'admin'],
  'config:promote': ['pricing_approver', 'admin'],
  'config:rollback': ['pricing_approver', 'admin'],
  'workbook:write': ['pricing_analyst', 'admin'],
  'workbook:read': [...WORKBENCH, 'api_client'],
  'audit:read': WORKBENCH,
  'feedback:create': ['agent', ...WORKBENCH],
  'feedback:review': ['pricing_approver', 'admin'],
  'testtools:run': [...WORKBENCH, 'api_client'],
  'admin:reset': ['admin'],
};
export const can = (user, perm) => !!user && (PERMISSIONS[perm] || []).includes(user.role);

export const DEMO_USERS = [
  { id: 'agent.demo', name: 'Avery Agent (demo)', role: 'agent', blurb: 'Quotes and saves submissions' },
  { id: 'analyst.demo', name: 'Priya Pricing-Analyst (demo)', role: 'pricing_analyst', blurb: 'Edits drafts, imports XLSX, submits for approval' },
  { id: 'approver.demo', name: 'Alex Approver (demo)', role: 'pricing_approver', blurb: 'Approves, promotes and rolls back' },
  { id: 'admin.demo', name: 'Morgan Admin (demo)', role: 'admin', blurb: 'All permissions (four-eyes still applies)' },
  { id: 'rateguard.client', name: 'Integration client (demo)', role: 'api_client', blurb: 'API-only client for a future integration' },
];

function hashPassword(pw, salt) { return crypto.scryptSync(pw, salt, 32); }
const b64 = (b) => Buffer.from(b).toString('base64url');

export class Auth {
  constructor({ mode = 'demo', secret, password, clientPassword, clock = () => new Date(), ttlSeconds = 8 * 3600 } = {}) {
    this.mode = mode;
    this.clock = clock;
    this.ttl = ttlSeconds;
    this.secret = secret || crypto.randomBytes(32).toString('hex');
    this.salt = crypto.randomBytes(16);
    const pw = password || 'pilot-demo-2026';
    const cpw = clientPassword || 'pilot-api-demo-2026';
    this.users = new Map(DEMO_USERS.map((u) => [u.id, { ...u, hash: hashPassword(u.role === 'api_client' ? cpw : pw, this.salt) }]));
    this.attempts = new Map();
    this.usingDefaultPassword = !password;
  }

  publicUsers() { return DEMO_USERS.map(({ id, name, role, blurb }) => ({ id, name, role, blurb })); }

  /** Only FAILED attempts count toward the limit; a successful sign-in clears the counter. */
  assertNotThrottled(key) {
    const now = Date.now();
    const rec = (this.attempts.get(key) || []).filter((t) => now - t < 5 * 60_000);
    this.attempts.set(key, rec);
    if (rec.length >= 10) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed sign-in attempts. Wait a few minutes and try again.');
  }

  login(username, password, ip = '') {
    const key = `${ip}|${username}`;
    this.assertNotThrottled(key);
    const u = this.users.get(String(username || ''));
    const given = hashPassword(String(password ?? ''), this.salt);
    if (!u || !crypto.timingSafeEqual(given, u.hash)) {
      this.attempts.get(key).push(Date.now());
      throw new HttpError(401, 'BAD_CREDENTIALS', 'Unknown user or wrong password.');
    }
    this.attempts.delete(key);
    const iat = Math.floor(this.clock().getTime() / 1000);
    const payload = { sub: u.id, name: u.name, role: u.role, iat, exp: iat + this.ttl };
    const body = b64(JSON.stringify(payload));
    const sig = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    return { token: `${body}.${sig}`, user: { id: u.id, name: u.name, role: u.role }, expiresAt: new Date(payload.exp * 1000).toISOString() };
  }

  verifyDemoToken(token) {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const expect = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    const a = Buffer.from(sig); const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
    if (!p.exp || p.exp < Math.floor(this.clock().getTime() / 1000)) return null;
    if (!this.users.has(p.sub)) return null;
    return { id: p.sub, name: p.name, role: p.role };
  }

  async verifyFirebaseToken(token) {
    // Lazy import keeps firebase-admin optional. Uses Application Default Credentials; no keys in repo.
    const admin = (await import('firebase-admin')).default;
    if (!admin.apps.length) admin.initializeApp();
    const decoded = await admin.auth().verifyIdToken(token);
    const role = decoded.pilotRole;
    if (!ROLES.includes(role)) return null;
    return { id: decoded.uid, name: decoded.name || decoded.email || decoded.uid, role };
  }

  /** Express middleware: attaches req.user or responds 401. */
  middleware() {
    return async (req, res, next) => {
      try {
        const h = req.get('authorization') || '';
        const m = h.match(/^Bearer (.+)$/i);
        if (!m) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required (Authorization: Bearer <token>).');
        const user = this.mode === 'firebase' ? await this.verifyFirebaseToken(m[1]).catch(() => null) : this.verifyDemoToken(m[1]);
        if (!user) throw new HttpError(401, 'INVALID_TOKEN', 'Your session is invalid or has expired. Sign in again.');
        req.user = user;
        next();
      } catch (e) { next(e); }
    };
  }
}

export const requires = (perm) => (req, _res, next) => (can(req.user, perm) ? next() : next(new HttpError(403, 'FORBIDDEN', `Your role (${req.user?.role}) is not allowed to do this (${perm}).`)));
