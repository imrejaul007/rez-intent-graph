/**
 * Integration Test for Commerce Memory External Services
 *
 * Tests the complete flow from Intent Graph → External Services → Backend Services
 *
 * Prerequisites:
 * - Redis running on localhost:6379
 * - Wallet service running on localhost:4004 (optional, tests will skip if unavailable)
 * - Order service running on localhost:3006 (optional, tests will skip if unavailable)
 */

import {
  chargeWallet,
  creditWallet,
  getWalletBalance,
  createOrder,
  updateOrderStatus,
  executeRoomServiceFlow,
  executeShoppingFlow,
  sendUserNotification,
  sendStaffNotification,
  getAllServiceHealth,
} from '../integrations/external-services.js';
import { sharedMemory } from '../agents/shared-memory.js';

// Test user IDs
const TEST_USERS = {
  user1: 'test-user-001',
  user2: 'test-user-002',
  merchant1: 'test-merchant-001',
  store1: 'test-store-001',
};

// Test helper
async function runTest(name: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    console.log(`\n🧪 Running: ${name}`);
    await fn();
    console.log(`✅ PASSED: ${name}`);
    return true;
  } catch (error) {
    console.error(`❌ FAILED: ${name}`, error);
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Integration Tests ─────────────────────────────────────────────────────────────

async function testWalletCharge(): Promise<void> {
  // Test charging a user wallet
  const result = await chargeWallet(TEST_USERS.user1, 100, 'Test charge for intent graph integration', {
    referenceType: 'nudge',
    referenceId: 'test-nudge-001',
  });

  if (!result.success) {
    throw new Error(`Wallet charge failed: ${result.error}`);
  }

  if (!result.transactionId) {
    throw new Error('No transaction ID returned');
  }

  console.log(`   Transaction ID: ${result.transactionId}`);
}

async function testWalletCredit(): Promise<void> {
  // Test crediting a user wallet (refund)
  const result = await creditWallet(TEST_USERS.user1, 50, 'Test refund for intent graph integration', {
    referenceType: 'refund',
    referenceId: 'test-refund-001',
  });

  if (!result.success) {
    throw new Error(`Wallet credit failed: ${result.error}`);
  }

  if (!result.transactionId) {
    throw new Error('No transaction ID returned');
  }

  console.log(`   Transaction ID: ${result.transactionId}`);
}

async function testWalletBalance(): Promise<void> {
  // Test getting wallet balance
  const balance = await getWalletBalance(TEST_USERS.user1);

  if (!balance) {
    throw new Error('Failed to get wallet balance');
  }

  console.log(`   Balance: ${balance.total} coins (available: ${balance.available})`);
}

async function testOrderCreation(): Promise<void> {
  // Test creating an order
  const result = await createOrder({
    userId: TEST_USERS.user1,
    storeId: TEST_USERS.store1,
    items: [
      { name: 'Test Item 1', quantity: 2, price: 100 },
      { name: 'Test Item 2', quantity: 1, price: 50 },
    ],
    deliveryType: 'pickup',
    paymentMethod: 'wallet',
  });

  if (!result.success) {
    throw new Error(`Order creation failed: ${result.error}`);
  }

  if (!result.orderId) {
    throw new Error('No order ID returned');
  }

  console.log(`   Order ID: ${result.orderId}, Total: ${result.total}`);
}

async function testOrderStatusUpdate(): Promise<void> {
  // First create an order
  const createResult = await createOrder({
    userId: TEST_USERS.user1,
    storeId: TEST_USERS.store1,
    items: [{ name: 'Test Item', quantity: 1, price: 100 }],
    paymentMethod: 'wallet',
  });

  if (!createResult.orderId) {
    throw new Error('Failed to create test order');
  }

  // Update status
  const result = await updateOrderStatus(createResult.orderId, 'confirmed');

  if (!result.success) {
    throw new Error(`Order status update failed: ${result.error}`);
  }

  console.log(`   Order ${createResult.orderId} updated to confirmed`);
}

async function testUserNotification(): Promise<void> {
  // Test sending a user notification
  const result = await sendUserNotification(
    TEST_USERS.user1,
    'Test Notification',
    'This is a test notification from intent graph',
    { intentId: 'test-intent-001' }
  );

  if (!result.success) {
    throw new Error(`Notification failed: ${result.error}`);
  }

  console.log(`   Notification ID: ${result.notificationId}`);
}

async function testStaffNotification(): Promise<void> {
  // Test sending a staff notification
  const result = await sendStaffNotification({
    department: 'concierge',
    title: 'Test Staff Alert',
    message: 'This is a test staff notification from intent graph',
    priority: 'high',
    actionRequired: 'Review and respond',
  });

  if (!result.success) {
    throw new Error(`Staff notification failed: ${result.error}`);
  }

  console.log(`   Notification ID: ${result.notificationId}`);
}

async function testRoomServiceFlow(): Promise<void> {
  // Test complete room service flow
  const result = await executeRoomServiceFlow(
    TEST_USERS.user1,
    '101',
    'test-hotel-001',
    [
      { name: 'Coffee', quantity: 2, price: 50 },
      { name: 'Sandwich', quantity: 1, price: 120 },
    ],
    ['Complimentary cookie']
  );

  if (!result.success) {
    throw new Error(`Room service flow failed: ${result.error}`);
  }

  console.log(`   Room service completed:`, {
    walletTransactionId: result.walletTransactionId,
    pmsRequestId: result.pmsRequestId,
    taskId: result.taskId,
    notificationId: result.notificationId,
    totalCharged: result.totalCharged,
  });
}

async function testShoppingFlow(): Promise<void> {
  // Test complete shopping flow
  const result = await executeShoppingFlow(
    TEST_USERS.user1,
    TEST_USERS.store1,
    TEST_USERS.merchant1,
    [
      { name: 'Running Shoes', quantity: 1, price: 2000, productId: 'prod-001' },
      { name: 'Sports Socks', quantity: 2, price: 200, productId: 'prod-002' },
    ]
  );

  if (!result.success) {
    throw new Error(`Shopping flow failed: ${result.error}`);
  }

  console.log(`   Shopping completed:`, {
    orderId: result.orderId,
    merchantOrderId: result.merchantOrderId,
    total: result.total,
  });
}

async function testSharedMemory(): Promise<void> {
  // Test that shared memory is working correctly
  const testKey = `test:${Date.now()}`;
  const testValue = { data: 'test', timestamp: new Date() };

  await sharedMemory.set(testKey, testValue, 3600);
  const retrieved = await sharedMemory.get<typeof testValue>(testKey);

  if (!retrieved || retrieved.data !== 'test') {
    throw new Error('Shared memory get/set failed');
  }

  console.log(`   Shared memory working correctly`);
}

async function testServiceHealth(): Promise<void> {
  // Test service health checks
  const health = await getAllServiceHealth();

  console.log(`   Service health:`, health);
}

// ── Main Test Runner ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Commerce Memory External Services Integration Tests');
  console.log('═══════════════════════════════════════════════════════════════');

  const results: Array<{ name: string; passed: boolean }> = [];

  // Core tests (always run)
  results.push({
    name: 'Shared Memory',
    passed: await runTest('Shared Memory', testSharedMemory),
  });

  results.push({
    name: 'Wallet Charge',
    passed: await runTest('Wallet Charge', testWalletCharge),
  });

  results.push({
    name: 'Wallet Credit',
    passed: await runTest('Wallet Credit', testWalletCredit),
  });

  results.push({
    name: 'Wallet Balance',
    passed: await runTest('Wallet Balance', testWalletBalance),
  });

  results.push({
    name: 'Order Creation',
    passed: await runTest('Order Creation', testOrderCreation),
  });

  results.push({
    name: 'Order Status Update',
    passed: await runTest('Order Status Update', testOrderStatusUpdate),
  });

  results.push({
    name: 'User Notification',
    passed: await runTest('User Notification', testUserNotification),
  });

  results.push({
    name: 'Staff Notification',
    passed: await runTest('Staff Notification', testStaffNotification),
  });

  // Flow tests
  results.push({
    name: 'Room Service Flow',
    passed: await runTest('Room Service Flow', testRoomServiceFlow),
  });

  results.push({
    name: 'Shopping Flow',
    passed: await runTest('Shopping Flow', testShoppingFlow),
  });

  // Health check
  await runTest('Service Health', testServiceHealth);

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Test Summary');
  console.log('═══════════════════════════════════════════════════════════════');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`\n  Total: ${results.length}`);
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);

  if (failed > 0) {
    console.log('\n  Failed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`    - ${r.name}`);
    });
    process.exit(1);
  } else {
    console.log('\n  🎉 All tests passed!');
    process.exit(0);
  }
}

// Run tests
main().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
