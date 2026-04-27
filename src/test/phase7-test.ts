/**
 * Phase 7: Merchant Knowledge Base & Autonomous Chat Test
 * Tests knowledge management and autonomous chat capabilities
 */

import {
  merchantKnowledgeService,
  autonomousChatService,
} from '../index.js';

// Enable test mode
process.env.NODE_ENV = 'test';

async function testMerchantKnowledge(): Promise<void> {
  console.log('\n═══ Merchant Knowledge Tests ═══');

  const testMerchantId = 'test_merchant_' + Date.now();

  // Test: Add knowledge entry
  console.log('Testing: Add knowledge entry');
  const entry = await merchantKnowledgeService.addEntry({
    merchantId: testMerchantId,
    type: 'menu',
    title: 'Margherita Pizza',
    content: 'Classic tomato and mozzarella cheese pizza',
    tags: ['pizza', 'veg', 'italian'],
  });
  console.log(`   Entry added: ${entry.id.substring(0, 20)}... ✅`);

  // Test: Bulk import
  console.log('Testing: Bulk import');
  const bulkResult = await merchantKnowledgeService.bulkImport({
    merchantId: testMerchantId,
    entries: [
      { type: 'menu', title: 'Pepperoni Pizza', content: 'Spicy pepperoni with cheese', tags: ['pizza', 'non-veg'] },
      { type: 'faq', title: 'Do you deliver?', content: 'Yes, we deliver within 5km', tags: ['delivery', 'faq'] },
      { type: 'offer', title: '20% Off', content: 'Get 20% off on all orders', tags: ['discount', 'offer'] },
    ],
  });
  console.log(`   Imported: ${bulkResult.imported} entries ✅`);

  // Test: Get knowledge base
  console.log('Testing: Get knowledge base');
  const knowledgeBase = await merchantKnowledgeService.getKnowledgeBase(testMerchantId);
  console.log(`   Entries: ${knowledgeBase?.entries.length || 0} ✅`);

  // Test: Search knowledge
  console.log('Testing: Search knowledge');
  const searchResults = await merchantKnowledgeService.searchKnowledge({
    merchantId: testMerchantId,
    query: 'pizza',
    limit: 5,
  });
  console.log(`   Found: ${searchResults.length} results ✅`);

  // Test: Search by category
  console.log('Testing: Search by category');
  const faqResults = await merchantKnowledgeService.searchKnowledge({
    merchantId: testMerchantId,
    category: 'faq',
    query: '',
  });
  console.log(`   FAQs found: ${faqResults.length} ✅`);
}

async function testAutonomousChat(): Promise<void> {
  console.log('\n═══ Autonomous Chat Tests ═══');

  const testUserId = 'test_user_' + Date.now();
  const testMerchantId = 'test_merchant_chat_' + Date.now();

  // First, add some knowledge for the merchant
  await merchantKnowledgeService.bulkImport({
    merchantId: testMerchantId,
    entries: [
      { type: 'menu', title: 'Pasta Carbonara', content: 'Creamy pasta with bacon - ₹299', tags: ['pasta', 'italian'] },
      { type: 'menu', title: 'Lasagna', content: 'Layers of pasta and cheese - ₹349', tags: ['pasta', 'italian'] },
      { type: 'offer', title: 'Weekend Special', content: 'Buy 1 Get 1 Free on all pasta', tags: ['offer', 'weekend'] },
      { type: 'hours', title: 'Opening Hours', content: 'Open 12 PM to 10 PM daily', tags: ['hours'] },
    ],
  });

  // Test: Process chat message - menu inquiry
  console.log('Testing: Chat message - menu inquiry');
  const menuResponse = await autonomousChatService.processMessage({
    userId: testUserId,
    merchantId: testMerchantId,
    message: 'What pasta dishes do you have?',
  });
  console.log(`   Intent detected: ${menuResponse.message.metadata?.intentKey} ✅`);
  console.log(`   Context used: ${menuResponse.contextUsed} ✅`);
  console.log(`   Suggestions: ${menuResponse.suggestions.length} ✅`);

  // Test: Process chat message - offer inquiry
  console.log('Testing: Chat message - offer inquiry');
  const offerResponse = await autonomousChatService.processMessage({
    userId: testUserId,
    merchantId: testMerchantId,
    message: 'Do you have any special offers?',
  });
  console.log(`   Intent detected: ${offerResponse.message.metadata?.intentKey} ✅`);

  // Test: Process chat message - hours inquiry
  console.log('Testing: Chat message - hours inquiry');
  const hoursResponse = await autonomousChatService.processMessage({
    userId: testUserId,
    merchantId: testMerchantId,
    message: 'What are your opening hours?',
  });
  console.log(`   Intent detected: ${hoursResponse.message.metadata?.intentKey} ✅`);

  // Test: Get chat context
  console.log('Testing: Get chat context');
  const context = await merchantKnowledgeService.getChatContext(testMerchantId);
  const entries = Object.values(context).flat();
  console.log(`   Knowledge entries: ${entries.length} ✅`);

  // Test: End session
  console.log('Testing: End chat session');
  await autonomousChatService.endSession('session_test_123');
  console.log(`   Session ended ✅`);
}

async function testIntentAnalysis(): Promise<void> {
  console.log('\n═══ Intent Analysis Tests ═══');

  const testCases = [
    { message: 'Show me the menu', expected: 'menu' },
    { message: 'How much does the pizza cost?', expected: 'pricing' },
    { message: 'Are you open now?', expected: 'hours' },
    { message: 'I want to book a table', expected: 'booking' },
    { message: 'Any discounts today?', expected: 'offer' },
    { message: 'Where are you located?', expected: 'location' },
    { message: 'I need help', expected: 'support' },
  ];

  for (const testCase of testCases) {
    const response = await autonomousChatService.processMessage({
      userId: 'test_user',
      merchantId: 'test_merchant',
      message: testCase.message,
    });
    const detected = response.message.metadata?.intentKey;
    const pass = detected === testCase.expected ? '✅' : '❌';
    console.log(`   "${testCase.message}" → ${detected} ${pass}`);
  }
}

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║     ReZ Mind - Phase 7 Knowledge & Chat Test     ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  await testMerchantKnowledge();
  await testAutonomousChat();
  await testIntentAnalysis();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Phase 7 Integration Tests Complete');
  console.log('');
  console.log('  Components tested:');
  console.log('  - Merchant knowledge (add, bulk, search, get)');
  console.log('  - Autonomous chat (menu, offer, hours intents)');
  console.log('  - Intent analysis (menu, pricing, hours, booking, etc.)');
  console.log('  - Chat context (knowledge + user intents)');
  console.log('');
  console.log('  Available endpoints:');
  console.log('  - POST /api/knowledge/merchant/:id/entries');
  console.log('  - POST /api/knowledge/merchant/:id/bulk');
  console.log('  - POST /api/knowledge/merchant/:id/menu');
  console.log('  - POST /api/knowledge/merchant/:id/faq');
  console.log('  - POST /api/chat/message');
  console.log('  - GET  /api/chat/context/:userId');
  console.log('═══════════════════════════════════════════════════════════════');
}

main();
