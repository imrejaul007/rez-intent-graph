/**
 * External Services Configuration
 * SOURCE OF TRUTH for all external service URLs
 *
 * All service URLs are defined here and referenced throughout the codebase.
 * Override individual services via environment variables.
 *
 * To update a service URL, change it here AND in your .env file.
 */

export const SERVICE_URLS = {
  // ── Core ReZ Services ────────────────────────────────────────────────────────
  wallet:       process.env.WALLET_SERVICE_URL        || 'https://rez-wallet-service-36vo.onrender.com',
  monolith:     process.env.MONOLITH_URL            || 'https://rez-backend-8dfu.onrender.com',
  order:        process.env.ORDER_SERVICE_URL         || 'https://rez-order-service-hz18.onrender.com',
  payment:      process.env.PAYMENT_SERVICE_URL      || 'https://rez-payment-service.onrender.com',
  merchant:     process.env.MERCHANT_SERVICE_URL     || 'https://rez-merchant-service-n3q2.onrender.com',

  // ── Messaging & Notifications ────────────────────────────────────────────────
  notification: process.env.NOTIFICATION_SERVICE_URL || 'https://rez-notification-events-mwdz.onrender.com',

  // ── Authentication ───────────────────────────────────────────────────────────
  auth:         process.env.AUTH_SERVICE_URL         || 'https://rez-auth-service.onrender.com',

  // ── Product & Search ────────────────────────────────────────────────────────
  catalog:      process.env.CATALOG_SERVICE_URL      || 'https://rez-catalog-service-1.onrender.com',
  search:       process.env.SEARCH_SERVICE_URL       || 'https://rez-search-service.onrender.com',

  // ── Growth & Marketing ────────────────────────────────────────────────────
  marketing:    process.env.MARKETING_SERVICE_URL    || 'https://rez-marketing-service.onrender.com',
  gamification: process.env.GAMIFICATION_SERVICE_URL || 'https://rez-gamification-service-3b5d.onrender.com',
  ads:          process.env.ADS_SERVICE_URL           || 'https://rez-ads-service.onrender.com',

  // ── Hotel & PMS ─────────────────────────────────────────────────────────────
  pms:          process.env.PMS_SERVICE_URL           || 'https://rez-pms-service.onrender.com',

  // ── Analytics ──────────────────────────────────────────────────────────────
  analytics:    process.env.ANALYTICS_SERVICE_URL    || 'https://analytics-events-37yy.onrender.com',
} as const;

export type ServiceName = keyof typeof SERVICE_URLS;

export default SERVICE_URLS;
