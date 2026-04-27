/**
 * MongoDB Connection Utility
 * ReZ Mind - Intent Graph using MongoDB
 */

import mongoose from 'mongoose';

// MongoDB connection string for ReZ ecosystem
const MONGODB_URI = process.env.MONGODB_URI || (() => {
  throw new Error(
    'MONGODB_URI environment variable is required. ' +
    'Copy .env.example to .env and set your MongoDB connection string.'
  );
})();

let isConnected = false;

export async function connectDB(): Promise<typeof mongoose> {
  if (isConnected) {
    return mongoose;
  }

  try {
    const conn = await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    isConnected = true;
    console.log(`MongoDB connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

export async function disconnectDB(): Promise<void> {
  if (!isConnected) {
    return;
  }

  try {
    await mongoose.disconnect();
    isConnected = false;
    console.log('MongoDB disconnected');
  } catch (error) {
    console.error('MongoDB disconnection error:', error);
    throw error;
  }
}

export function getConnectionStatus(): boolean {
  return isConnected;
}

export default mongoose;
