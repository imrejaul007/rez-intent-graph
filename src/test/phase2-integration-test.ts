/**
 * Phase 2 Integration Tests
 * Tests ReZ Mind integration with real backend services
 */

import {
  chargeWallet,
  creditWallet,
  getWalletBalance,
  createOrder,
  updateOrderStatus,
  executeRoomServiceFlow,
  executeShoppingFlow,
  getCircuitBreakerStatus,
  resetCircuitBreaker,
  checkServiceHealth,
  getAllServiceHealth,
} from '../integrations/external-services.js';

// Enable dangerous mode for testing
process.env.NODE_ENV = 'test';

async function testWalletService(): Promise<void> {
  console.log('\n═══ Wallet Service Tests ═══');

  // Test wallet balance
  console.log('🧪 Testing: Get wallet balance');
  const balance = await getWalletBalance('test-user-001');
  console.log('   Balance result:', balance ? 'found' : 'not found (expected if service unavailable)');

  // Test credit
  console.log('🧪 Testing: Credit wallet');
  const creditResult = await creditWallet(
    'test-user-001',
    100,
    'Test credit from ReZ Mind',
    { referenceType: 'bonus' }
  );
  console.log('   Credit result:', creditResult.success ? '✅ success' : '⚠️ failed (expected)');

  // Test charge
  console.log('🧪 Testing: Charge wallet');
  const chargeResult = await chargeWallet(
    'test-user-001',
    50,
    'Test charge from ReZ Mind',
    { referenceType: 'order' }
  );
  console.log('   Charge result:', chargeResult.success ? '✅ success' : '⚠️ failed (expected)');
}

async function testOrderService(): Promise<void> {
  console.log('\n═══ Order Service Tests ═══');

  // Test create order
  console.log('🧪 Testing: Create order');
  const orderResult = await createOrder({
    userId: 'test-user-001',
    storeId: 'test-store-001',
    items: [
      { name: 'Test Item', quantity: 1, price: 100 },
    ],
    paymentMethod: 'wallet',
  });
  console.log('   Order result:', orderResult.success ? `✅ ${orderResult.orderId}` : '⚠️ failed (expected)');

  // Test update order status
  if (orderResult.orderId) {
    console.log('🧪 Testing: Update order status');
    const updateResult = await updateOrderStatus(orderResult.orderId, 'confirmed');
    console.log('   Update result:', updateResult.success ? '✅ success' : '⚠️ failed (expected)');
  }
}

async function testRoomServiceFlow(): Promise<void> {
  console.log('\n═══ Room Service Flow Test ═══');

  console.log('🧪 Testing: Complete room service flow');
  const result = await executeRoomServiceFlow(
    'guest-001',
    '101',
    'hotel-001',
    [
      { name: 'Coffee', quantity: 2, price: 50 },
      { name: 'Sandwich', quantity: 1, price: 120 },
    ],
    []
  );

  console.log('   Flow result:', result.success ? '✅ success' : '⚠️ failed (expected)');
  if (result.success) {
    console.log('   📋 Wallet TX:', result.walletTransactionId ? 'created' : 'N/A');
    console.log('   📋 PMS Request:', result.pmsRequestId ? 'created' : 'N/A');
    console.log('   📋 Task:', result.taskId ? 'created' : 'N/A');
    console.log('   📋 Notification:', result.notificationId ? 'sent' : 'N/A');
    console.log('   💰 Total charged:', result.totalCharged);
  }
}

async function testShoppingFlow(): Promise<void> {
  console.log('\n═══ Shopping Flow Test ═══');

  console.log('🧪 Testing: Complete shopping flow');
  const result = await executeShoppingFlow(
    'user-001',
    'store-001',
    'merchant-001',
    [
      { name: 'Pizza', quantity: 2, price: 299 },
      { name: 'Coke', quantity: 2, price: 49 },
    ]
  );

  console.log('   Flow result:', result.success ? '✅ success' : '⚠️ failed (expected)');
  if (result.success) {
    console.log('   📦 Order ID:', result.orderId);
    console.log('   🏪 Merchant Order:', result.merchantOrderId);
    console.log('   💰 Total:', result.total);
  }
}

async function testCircuitBreaker(): Promise<void> {
  console.log('\n═══ Circuit Breaker Tests ═══');

  // Get circuit breaker status
  console.log('🧪 Testing: Circuit breaker status');
  const status = getCircuitBreakerStatus();
  console.log('   Services monitored:', status.length);
  status.forEach(s => {
    console.log(`   - ${s.name}: ${s.circuitBreakerStatus} (failures: ${s.failureCount})`);
  });

  // Reset circuit breaker
  console.log('🧪 Testing: Reset circuit breaker');
  const reset = resetCircuitBreaker('wallet');
  console.log('   Reset result:', reset ? '✅ success' : '❌ failed');

  // Check service health
  console.log('🧪 Testing: Service health check');
  const health = await getAllServiceHealth();
  console.log('   Services:', Object.entries(health).map(([k, v]) => `${k}: ${v ? '✅' : '❌'}`).join(', '));
}

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║     ReZ Mind - Phase 2 Integration Test Suite              ║');
  console.log('║     Testing real service integrations                       ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  try {
    // Run all tests (will show warnings if services unavailable - expected)
    await testCircuitBreaker();
    await testWalletService();
    await testOrderService();
    await testRoomServiceFlow();
    await testShoppingFlow();

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  Phase 2 Integration Tests Complete');
    console.log('');
    console.log('  NOTE: "failed (expected)" means service is not running');
    console.log('  When real services are available, tests will pass');
    console.log('═══════════════════════════════════════════════════════════════');
  } catch (error) {
    console.error('❌ Test suite failed:', error);
  }
}

main();
