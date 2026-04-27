// ── Chat & Merchant Knowledge API Routes ──────────────────────────────────────────
// Phase 7: Autonomous chat and merchant knowledge management

import { Router, Request, Response } from 'express';
import {
  merchantKnowledgeService,
  type MerchantKnowledgeEntry,
  type KnowledgeType,
} from '../integrations/merchantKnowledge.js';
import { autonomousChatService, type ChatResponse } from '../chat/autonomousChat.js';
import { verifyInternalToken, requireUserOrAuth } from '../middleware/auth.js';
import { strictLimiter } from '../middleware/rateLimit.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════════════
// MERCHANT KNOWLEDGE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/knowledge/merchant/:merchantId/entries
 * Add a knowledge entry for a merchant
 */
router.post('/knowledge/merchant/:merchantId/entries', verifyInternalToken, async (req: Request, res: Response) => {
  const { merchantId } = req.params;
  const { type, title, content, tags, metadata } = req.body;

  if (!type || !title || !content) {
    res.status(400).json({ error: 'type, title, and content are required' });
    return;
  }

  try {
    const entry = await merchantKnowledgeService.addEntry({
      merchantId,
      type,
      title,
      content,
      tags,
      metadata,
    });
    res.json({ success: true, entry });
  } catch (error) {
    console.error('[KnowledgeAPI] Add entry failed:', error);
    res.status(500).json({ error: 'Failed to add knowledge entry' });
  }
});

/**
 * POST /api/knowledge/merchant/:merchantId/bulk
 * Bulk import knowledge entries
 */
router.post('/knowledge/merchant/:merchantId/bulk', verifyInternalToken, async (req: Request, res: Response) => {
  const { merchantId } = req.params;
  const { entries } = req.body;

  if (!Array.isArray(entries)) {
    res.status(400).json({ error: 'entries array is required' });
    return;
  }

  try {
    const result = await merchantKnowledgeService.bulkImport({
      merchantId,
      entries,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[KnowledgeAPI] Bulk import failed:', error);
    res.status(500).json({ error: 'Failed to bulk import' });
  }
});

/**
 * GET /api/knowledge/merchant/:merchantId
 * Get merchant's full knowledge base
 */
router.get('/knowledge/merchant/:merchantId', async (req: Request, res: Response) => {
  const { merchantId } = req.params;

  try {
    const knowledgeBase = await merchantKnowledgeService.getKnowledgeBase(merchantId);
    if (!knowledgeBase) {
      res.status(404).json({ error: 'Knowledge base not found' });
      return;
    }
    res.json(knowledgeBase);
  } catch (error) {
    console.error('[KnowledgeAPI] Get knowledge base failed:', error);
    res.status(500).json({ error: 'Failed to get knowledge base' });
  }
});

/**
 * GET /api/knowledge/merchant/:merchantId/search
 * Search merchant knowledge
 */
router.get('/knowledge/merchant/:merchantId/search', async (req: Request, res: Response) => {
  const { merchantId } = req.params;
  const { q, type, limit } = req.query;

  if (!q) {
    res.status(400).json({ error: 'q (query) is required' });
    return;
  }

  try {
    const results = await merchantKnowledgeService.searchKnowledge({
      merchantId,
      query: q as string,
      category: type as string | undefined,
      limit: limit ? parseInt(limit as string) : 20,
    });
    res.json({ results, count: results.length });
  } catch (error) {
    console.error('[KnowledgeAPI] Search failed:', error);
    res.status(500).json({ error: 'Failed to search knowledge' });
  }
});

/**
 * PUT /api/knowledge/entries/:entryId
 * Update knowledge entry
 */
router.put('/knowledge/entries/:entryId', verifyInternalToken, async (req: Request, res: Response) => {
  const { entryId } = req.params;
  const { title, content, tags, active } = req.body;

  try {
    const entry = await merchantKnowledgeService.updateEntry(entryId, {
      title,
      content,
      tags,
      active,
    });
    if (!entry) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }
    res.json({ success: true, entry });
  } catch (error) {
    console.error('[KnowledgeAPI] Update entry failed:', error);
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

/**
 * DELETE /api/knowledge/entries/:entryId
 * Delete knowledge entry
 */
router.delete('/knowledge/entries/:entryId', verifyInternalToken, async (req: Request, res: Response) => {
  const { entryId } = req.params;

  try {
    const success = await merchantKnowledgeService.deleteEntry(entryId);
    res.json({ success });
  } catch (error) {
    console.error('[KnowledgeAPI] Delete entry failed:', error);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════
// AUTONOMOUS CHAT
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/chat/message
 * Send a chat message and get autonomous response
 */
router.post('/chat/message', requireUserOrAuth, strictLimiter, async (req: Request, res: Response) => {
  const { userId, merchantId, message, sessionId } = req.body;

  if (!userId || !message) {
    res.status(400).json({ error: 'userId and message are required' });
    return;
  }

  try {
    const response = await autonomousChatService.processMessage({
      userId,
      merchantId,
      message,
      sessionId,
    });
    res.json(response);
  } catch (error) {
    console.error('[ChatAPI] Process message failed:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

/**
 * GET /api/chat/history/:userId
 * Get chat history for a user
 */
router.get('/chat/history/:userId', requireUserOrAuth, async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { limit } = req.query;

  try {
    const sessions = await autonomousChatService.getChatHistory(userId, limit ? parseInt(limit as string) : 10);
    res.json({ sessions });
  } catch (error) {
    console.error('[ChatAPI] Get history failed:', error);
    res.status(500).json({ error: 'Failed to get chat history' });
  }
});

/**
 * POST /api/chat/end-session
 * End a chat session
 */
router.post('/chat/end-session', requireUserOrAuth, async (req: Request, res: Response) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    res.status(400).json({ error: 'sessionId is required' });
    return;
  }

  try {
    await autonomousChatService.endSession(sessionId);
    res.json({ success: true });
  } catch (error) {
    console.error('[ChatAPI] End session failed:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

/**
 * GET /api/chat/context/:userId
 * Get chat context for a user (merchant knowledge + user intents)
 */
router.get('/chat/context/:userId', requireUserOrAuth, async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { merchantId, query } = req.query;

  if (!query) {
    res.status(400).json({ error: 'query is required' });
    return;
  }

  if (!merchantId) {
    res.status(400).json({ error: 'merchantId is required' });
    return;
  }

  try {
    const context = await merchantKnowledgeService.getChatContext({
      userId,
      merchantId: merchantId as string,
      query: query as string,
    });
    res.json(context);
  } catch (error) {
    console.error('[ChatAPI] Get context failed:', error);
    res.status(500).json({ error: 'Failed to get chat context' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════
// MERCHANT UPLOAD HELPERS
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/knowledge/merchant/:merchantId/menu
 * Upload menu items as knowledge entries
 */
router.post('/knowledge/merchant/:merchantId/menu', verifyInternalToken, async (req: Request, res: Response) => {
  const { merchantId } = req.params;
  const { items } = req.body;

  if (!Array.isArray(items)) {
    res.status(400).json({ error: 'items array is required' });
    return;
  }

  const entries = items.map((item: { name: string; description: string; price?: number; category?: string }) => ({
    type: 'menu' as KnowledgeType,
    title: item.name,
    content: `${item.description}${item.price ? ` - ₹${item.price}` : ''}`,
    tags: [item.category || 'menu', 'food', 'dish'],
  }));

  try {
    const result = await merchantKnowledgeService.bulkImport({
      merchantId,
      entries,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[KnowledgeAPI] Menu upload failed:', error);
    res.status(500).json({ error: 'Failed to upload menu' });
  }
});

/**
 * POST /api/knowledge/merchant/:merchantId/policy
 * Upload policies as knowledge entries
 */
router.post('/knowledge/merchant/:merchantId/policy', verifyInternalToken, async (req: Request, res: Response) => {
  const { merchantId } = req.params;
  const { policies } = req.body;

  if (!Array.isArray(policies)) {
    res.status(400).json({ error: 'policies array is required' });
    return;
  }

  const entries = policies.map((policy: { title: string; content: string }) => ({
    type: 'policy' as KnowledgeType,
    title: policy.title,
    content: policy.content,
    tags: ['policy', 'rules', 'terms'],
  }));

  try {
    const result = await merchantKnowledgeService.bulkImport({
      merchantId,
      entries,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[KnowledgeAPI] Policy upload failed:', error);
    res.status(500).json({ error: 'Failed to upload policies' });
  }
});

/**
 * POST /api/knowledge/merchant/:merchantId/faq
 * Upload FAQs as knowledge entries
 */
router.post('/knowledge/merchant/:merchantId/faq', verifyInternalToken, async (req: Request, res: Response) => {
  const { merchantId } = req.params;
  const { faqs } = req.body;

  if (!Array.isArray(faqs)) {
    res.status(400).json({ error: 'faqs array is required' });
    return;
  }

  const entries = faqs.map((faq: { question: string; answer: string }) => ({
    type: 'faq' as KnowledgeType,
    title: faq.question,
    content: faq.answer,
    tags: ['faq', 'question', 'help'],
  }));

  try {
    const result = await merchantKnowledgeService.bulkImport({
      merchantId,
      entries,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[KnowledgeAPI] FAQ upload failed:', error);
    res.status(500).json({ error: 'Failed to upload FAQs' });
  }
});

export default router;
