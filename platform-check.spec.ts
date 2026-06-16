import { test, expect } from '@playwright/test';

test.describe('Platform Health Checks', () => {

  const platforms = [
    { name: 'ChatGPT', url: 'https://chatgpt.com' },
    { name: 'Claude',   url: 'https://claude.ai' },
    { name: 'Grok',     url: 'https://grok.x.ai' },
    { name: 'Gemini',   url: 'https://gemini.google.com' },
    { name: 'Perplexity', url: 'https://www.perplexity.ai' },
    { name: 'DeepSeek', url: 'https://chat.deepseek.com' },
  ];

  for (const platform of platforms) {
    test(`${platform.name} - basic load check`, async ({ page }) => {
      await page.goto(platform.url, { waitUntil: 'domcontentloaded' });
      
      // Warte auf stabile Seitenladung
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      const selectors = getPlatformSelectors(platform.name);

      let success = false;
      let lastError = '';

      for (const selector of selectors) {
        try {
          await expect(page.locator(selector)).toBeVisible({ timeout: 8000 });
          console.log(`✅ ${platform.name}: Seite erfolgreich geladen mit Selektor "${selector}"`);
          success = true;
          break;
        } catch (error) {
          lastError = error.message;
        }
      }

      if (!success) {
        await page.screenshot({ 
          path: `test-results/${platform.name.toLowerCase()}-failure.png`, 
          fullPage: true 
        });
        console.error(`❌ ${platform.name} failed. Last error: ${lastError}`);
        throw new Error(`${platform.name} check failed. Last selector error: ${lastError}`);
      }
    });
  }
});

// Hilfsfunktion mit robusten Selektoren pro Plattform
function getPlatformSelectors(platform: string): string[] {
  switch (platform) {
    case 'ChatGPT':
      return [
        'textarea[data-id="root"]',
        'main',
        '[data-message-author-role]',
        '[data-testid^="conversation-turn"]',
        'nav[aria-label="Chat history"]'
      ];
    case 'Claude':
      return [
        'div[contenteditable="true"]',
        'article[data-testid="conversation-turn"]',
        '[data-testid="chat-title-button"]',
        '.font-claude-response'
      ];
    case 'Grok':
      return [
        'textarea[placeholder]',
        'main',
        '[data-testid*="message"]',
        '[class*="message-bubble"]'
      ];
    case 'Gemini':
      return [
        'rich-textarea',
        'ms-prompt-input-wrapper',
        '[data-message-author="user"]',
        'main'
      ];
    case 'Perplexity':
      return [
        'textarea[placeholder]',
        '[class*="ThreadTitle"]',
        '[data-testid*="query"]',
        'main'
      ];
    case 'DeepSeek':
      return [
        'textarea#chat-input',
        'textarea[placeholder]',
        '.ds-virtual-list-visible-items',
        '.ds-markdown'
      ];
    default:
      return ['main', 'body'];
  }
}
