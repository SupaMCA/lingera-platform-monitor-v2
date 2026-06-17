import { test, expect } from '@playwright/test';

test.describe('Platform Health Checks', () => {

  const platforms = [
    { name: 'ChatGPT',    url: 'https://chatgpt.com' },
    { name: 'Claude',     url: 'https://claude.ai' },
    { name: 'Grok',       url: 'https://grok.x.ai' },
    { name: 'Gemini',     url: 'https://gemini.google.com' },
    { name: 'Perplexity', url: 'https://www.perplexity.ai' },
    { name: 'DeepSeek',   url: 'https://chat.deepseek.com' },
  ];

  for (const platform of platforms) {
    test(`${platform.name} - basic load check`, async ({ page }) => {
      console.log(`🚀 Checking ${platform.name}...`);

      await page.goto(platform.url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });

      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      const selectors = getPlatformSelectors(platform.name);
      let success = false;                    // ← WICHTIG: Hier deklarieren!

      for (const selector of selectors) {
        try {
          await expect(page.locator(selector)).toBeVisible({ timeout: 12000 });
          console.log(`✅ ${platform.name}: OK with "${selector}"`);
          success = true;
          break;
        } catch (e) {
          // next selector
        }
      }

      if (!success) {
        console.error(`❌ ${platform.name} failed all selectors`);

        // Safe screenshot
        try {
          await page.screenshot({ 
            path: `test-results/${platform.name.toLowerCase()}-failure.png`, 
            fullPage: true 
          });
        } catch (screenshotError) {
          console.warn(`⚠️ Screenshot failed for ${platform.name}`);
        }

        throw new Error(`${platform.name} check failed`);
      }
    });
  }
});

function getPlatformSelectors(platform: string): string[] {
  switch (platform) {
    case 'ChatGPT':
      return ['textarea[data-id="root"]', 'main', '[data-message-author-role]'];
    case 'Claude':
      return ['div[contenteditable="true"]', 'article[data-testid="conversation-turn"]'];
    case 'Grok':
      return ['textarea[placeholder]', 'main'];
    case 'Gemini':
      return ['rich-textarea', 'main'];
    case 'Perplexity':
      return ['textarea[placeholder]', 'main'];
    case 'DeepSeek':
      return ['textarea#chat-input', 'textarea[placeholder]', 'main'];
    default:
      return ['main', 'body'];
  }
}
