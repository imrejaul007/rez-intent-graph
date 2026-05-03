/**
 * External Services Configuration
 * SOURCE OF TRUTH for all external service URLs
 *
 * H4 FIX: All hardcoded Render.com fallback URLs removed.
 * Each service URL now requires an environment variable.
 * In development (NODE_ENV !== 'production'), localhost fallbacks are used.
 * In production, missing env vars cause a warning but don't block startup.
 *
 * To deploy: set all *_SERVICE_URL env vars to your production endpoints.
 */

function getServiceUrl(name: string, envVar: string): string {
  const url = process.env[envVar];
  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(`[WARN] ${envVar} not set — ${name} integration disabled`);
      return '';
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
      INSIGHTS_SERVICE_URL: 'http://localhost:4014',
    };
    return portMap[envVar] || `http://localhost:${name}`;
  }
  return url;
}

export const SERVICE_URLS = {
  // ── Core ReZ Services ───────────────────────────────────────────────────────
  wallet:       getServiceUrl('wallet',       'WALLET_SERVICE_URL'),
  monolith:     getServiceUrl('monolith',     'MONOLITH_URL'),
  order:        getServiceUrl('order',        'ORDER_SERVICE_URL'),
  payment:      getServiceUrl('payment',      'PAYMENT_SERVICE_URL'),
  merchant:     getServiceUrl('merchant',    'MERCHANT_SERVICE_URL'),

  // ── Messaging & Notifications ───────────────────────────────────────────────
  notification: getServiceUrl('notification', 'NOTIFICATION_SERVICE_URL'),

  // ── Authentication ─────────────────────────────────────────────────────────
  auth:         getServiceUrl('auth',         'AUTH_SERVICE_URL'),

  // ── Product & Search ───────────────────────────────────────────────────────
  catalog:      getServiceUrl('catalog',      'CATALOG_SERVICE_URL'),
  search:       getServiceUrl('search',       'SEARCH_SERVICE_URL'),

  // ── Growth & Marketing ───────────────────────────────────────────────────
  marketing:    getServiceUrl('marketing',     'MARKETING_SERVICE_URL'),
  gamification: getServiceUrl('gamification',  'GAMIFICATION_SERVICE_URL'),
  ads:          getServiceUrl('ads',           'ADS_SERVICE_URL'),

  // ── Hotel & PMS ─────────────────────────────────────────────────────────────
  pms:          getServiceUrl('pms',          'PMS_SERVICE_URL'),

  // ── Analytics ─────────────────────────────────────────────────────────────
  analytics:    getServiceUrl('analytics',     'ANALYTICS_SERVICE_URL'),

  // ── Insights ─────────────────────────────────────────────────────────────
  insights:     getServiceUrl('insights',      'INSIGHTS_SERVICE_URL'),
} as const;

export type ServiceName = keyof typeof SERVICE_URLS;

export default SERVICE_URLS;
