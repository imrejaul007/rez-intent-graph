/**
 * External Services Configuration
 * SOURCE OF TRUTH for all external service URLs
 *
 * H4 FIX: All hardcoded Render.com fallback URLs removed.
 * Each service URL now requires an environment variable.
 * In development (NODE_ENV !== 'production'), localhost fallbacks are used.
 * In production, missing env vars cause a startup error.
 *
 * To deploy: set all *_SERVICE_URL env vars to your production endpoints.
 */

function requireServiceUrl(name: string, envVar: string): string {
  const url = process.env[envVar];
  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`[FATAL] ${envVar} is required in production — set it in your environment`);
    }
    // Development fallback to localhost
    const portMap: Record<string, string> = {
      WALLET_SERVICE_URL: 'http://localhost:4004',
      MONOLITH_URL: 'http://localhost:4000',
      ORDER_SERVICE_URL: 'http://localhost:4006',
      PAYMENT_SERVICE_URL: 'http://localhost:4002',
      MERCHANT_SERVICE_URL: 'http://localhost:4003',
      NOTIFICATION_SERVICE_URL: 'http://localhost:4005',
      AUTH_SERVICE_URL: 'http://localhost:4001',
      CATALOG_SERVICE_URL: 'http://localhost:4007',
      SEARCH_SERVICE_URL: 'http://localhost:4008',
      MARKETING_SERVICE_URL: 'http://localhost:4009',
      GAMIFICATION_SERVICE_URL: 'http://localhost:4010',
      ADS_SERVICE_URL: 'http://localhost:4011',
      PMS_SERVICE_URL: 'http://localhost:4012',
      ANALYTICS_SERVICE_URL: 'http://localhost:4013',
    };
    return portMap[envVar] || `http://localhost:${name}`;
  }
  return url;
}

export const SERVICE_URLS = {
  // ── Core ReZ Services ────────────────────────────────────────────────────────
  wallet:       requireServiceUrl('wallet',       'WALLET_SERVICE_URL'),
  monolith:     requireServiceUrl('monolith',     'MONOLITH_URL'),
  order:        requireServiceUrl('order',        'ORDER_SERVICE_URL'),
  payment:      requireServiceUrl('payment',      'PAYMENT_SERVICE_URL'),
  merchant:     requireServiceUrl('merchant',    'MERCHANT_SERVICE_URL'),

  // ── Messaging & Notifications ────────────────────────────────────────────────
  notification: requireServiceUrl('notification', 'NOTIFICATION_SERVICE_URL'),

  // ── Authentication ───────────────────────────────────────────────────────────
  auth:         requireServiceUrl('auth',         'AUTH_SERVICE_URL'),

  // ── Product & Search ────────────────────────────────────────────────────────
  catalog:      requireServiceUrl('catalog',      'CATALOG_SERVICE_URL'),
  search:       requireServiceUrl('search',       'SEARCH_SERVICE_URL'),

  // ── Growth & Marketing ────────────────────────────────────────────────────
  marketing:    requireServiceUrl('marketing',     'MARKETING_SERVICE_URL'),
  gamification: requireServiceUrl('gamification',  'GAMIFICATION_SERVICE_URL'),
  ads:          requireServiceUrl('ads',           'ADS_SERVICE_URL'),

  // ── Hotel & PMS ─────────────────────────────────────────────────────────────
  pms:          requireServiceUrl('pms',          'PMS_SERVICE_URL'),

  // ── Analytics ──────────────────────────────────────────────────────────────
  analytics:    requireServiceUrl('analytics',     'ANALYTICS_SERVICE_URL'),
} as const;

export type ServiceName = keyof typeof SERVICE_URLS;

export default SERVICE_URLS;
