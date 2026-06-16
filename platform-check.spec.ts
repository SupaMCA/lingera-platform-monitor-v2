// platform-check.spec.ts — Lingera Platform Monitor v2
// Health checks for all 6 supported AI platforms.
//
// Strategy: Multi-selector fallback for maximum resilience against DOM changes.
// Selectors derived from Lingera Chrome Extension (content.js v0.9.5.2+).

import { test, expect, Page } from '@playwright/test';

const LOAD_TIMEOUT = 15_000;
const ELEMENT_TIMEOUT = 12_000;

// Helper: Try multiple selectors, succeed on first visible match
async function expectAnyVisible(page: Page, selectors: string[], timeout = ELEMENT_TIMEOUT) {
  for (const sel of selectors) {
    try {
      await expect(page.locator(sel).first()).toBeVisible({ 
        timeout: Math.floor(timeout / selectors.length) + 3000 
      });
      console.log(`  ✅ Matched: ${sel}`);
      return;
    } catch (e) {
      // continue to next selector
    }
  }
  throw new Error(`None of the selectors matched: ${selectors.join(' | ')}`);
}

test.describe('Platform Health Checks', () => {

  // ── ChatGPT ──────────────────────────────
  test('ChatGPT — basic load check', async ({ page }) => {
    await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });
    await expect(page).toHaveTitle(/ChatGPT/i, { timeout: ELEMENT_TIMEOUT });

    await expectAnyVisible(page, [
      'main',
      '[role="main"]',
      '[data-message-author-role]',
      '[data-testid^="conversation-turn"]',
      'textarea',
      '#prompt-textarea',
    ]);
    console.log('✅ ChatGPT: Page loaded successfully');
  });

  // ── Claude ───────────────────────────────
  test('Claude — basic load check', async ({ page }) => {
    await page.goto('https://claude.ai', { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });
    await expect(page).toHaveTitle(/Claude/i, { timeout: ELEMENT_TIMEOUT });

    await expectAnyVisible(page, [
      'article[data-testid="conversation-turn"]',
      '[data-testid="chat-title-button"]',
      '[data-testid="user-message"]',
      'div[contenteditable="true"]',
      'main',
    ]);
    console.log('✅ Claude: Page loaded successfully');
  });

  // ── Grok ─────────────────────────────────
  test('Grok — basic load check', async ({ page }) => {
    await page.goto('https://grok.x.ai', { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });
    await expect(page).toHaveTitle(/Grok|xAI/i, { timeout: ELEMENT_TIMEOUT });

    await expectAnyVisible(page, [
      'main',
      '[role="main"]',
      '[data-testid*="message"]',
      'textarea',
    ]);
    console.log('✅ Grok: Page loaded successfully');
  });

  // ── Gemini ───────────────────────────────
  test('Gemini — basic load check', async ({ page }) => {
    await page.goto('https://gemini.google.com', { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });
    await expect(page).toHaveTitle(/Gemini/i, { timeout: ELEMENT_TIMEOUT });

    await expectAnyVisible(page, [
      'rich-textarea',
      '[data-message-author="user"]',
      'main',
      'textarea',
    ]);
    console.log('✅ Gemini: Page loaded successfully');
  });

  // ── Perplexity ───────────────────────────
  test('Perplexity — basic load check', async ({ page }) => {
    await page.goto('https://www.perplexity.ai', { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });
    await expect(page).toHaveTitle(/Perplexity/i, { timeout: ELEMENT_TIMEOUT });

    await expectAnyVisible(page, [
      '[class*="ThreadTitle"]',
      '[class*="query-text"]',
      'textarea',
      'main',
    ]);
    console.log('✅ Perplexity: Page loaded successfully');
  });

  // ── DeepSeek ─────────────────────────────
  test('DeepSeek — basic load check', async ({ page }) => {
    await page.goto('https://chat.deepseek.com', { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });
    await expect(page).toHaveTitle(/DeepSeek/i, { timeout: ELEMENT_TIMEOUT });

    await expectAnyVisible(page, [
      '.ds-virtual-list-visible-items',
      '.ds-markdown',
      'textarea',
      '#chat-input',
      'main',
    ]);
    console.log('✅ DeepSeek: Page loaded successfully');
  });

});
