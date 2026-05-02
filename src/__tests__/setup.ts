/**
 * Jest Test Setup
 * Global mocks, utilities, and configuration for all tests
 */

// Mock Environment Variables
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test-intent-graph';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'test-secret-key';
process.env.ENABLE_DORMANT_CRON = 'false';
process.env.ENABLE_AGENTS = 'false';
