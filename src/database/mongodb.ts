/**
 * MongoDB Connection Utility
 * ReZ Mind - Intent Graph using MongoDB
 *
 * SECURITY FIX: Enhanced with retry logic, connection pooling, and durability settings
 * matching other services in the ecosystem.
 */

import mongoose from 'mongoose';
import { log } from '../utils/logger.js';

// MongoDB connection string for ReZ ecosystem
const MONGODB_URI = process.env.MONGODB_URI || (() => {
  throw new Error(
    'MONGODB_URI environment variable is required. ' +
    'Copy .env.example to .env and set your MongoDB connection string.'
  );
})();

let isConnected = false;

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 1000;

async function connectWithRetry(attempt = 1): Promise<typeof mongoose> {
  try {
    const conn = await mongoose.connect(MONGODB_URI, {
      // Pool settings: increased from 10 to 50 for better concurrency
      maxPoolSize: 50,
      minPoolSize: 2,
      // Timeout settings
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      // Durability settings for write safety
      retryWrites: true,
      w: 'majority',
      journal: true,
      // Health check interval
      heartbeatFrequencyMS: 10000,
    });

    isConnected = true;
    log.info('[MongoDB] Connected', { host: conn.connection.host });
    return conn;
  } catch (error) {
    if (attempt >= MAX_RETRIES) {
      log.error('[MongoDB] Connection failed', { attempts: MAX_RETRIES, error: error instanceof Error ? error : String(error) });
      throw error;
    }

    const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
    log.warn('[MongoDB] Connection failed, retrying', { attempt, delayMs: delay });
    await new Promise(resolve => setTimeout(resolve, delay));
    return connectWithRetry(attempt + 1);
  }
}

export async function connectDB(): Promise<typeof mongoose> {
  if (isConnected) {
    return mongoose;
  }

  return connectWithRetry();
}

export async function disconnectDB(): Promise<void> {
  if (!isConnected) {
    return;
  }

  try {
    await mongoose.disconnect();
    isConnected = false;
    log.info('[MongoDB] Disconnected');
  } catch (error) {
    log.error('[MongoDB] Disconnection error', { error: error instanceof Error ? error : String(error) });
    throw error;
  }
}

export function getConnectionStatus(): boolean {
  return isConnected;
}

export default mongoose;
