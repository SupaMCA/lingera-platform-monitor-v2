import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Lingera Platform Health Checks v3.2
 * 
 * Changes from v3.1:
 * - NEW: Brand-Detection Tier (between Cloudflare & Login Wall)
 *   If page contains platform brand keywords, platform is alive → status "brand_detected"
 * - NEW: Diagnostics for failed checks — page title, final URL, and body snippet
 *   are included in error_message for debugging
 * - ChatGPT: div#prompt-textarea (ProseMirror contenteditable)
 * - DeepSeek: Password input + JS redirect detection
 * - Tiered detection: Cloudflare → Brand → Login Wall → Chat Input
 */

interface PlatformResult {
  platform: string;
  status: 'ok' | 'login_wall' | 'cloudflare' | 'brand_detected' | 'failed';
  error_message?: string;
  error_category?: string;
  response_time_ms: number;
  // Diagnostics (always populated for debugging)
  diagnostics?: {
    final_url: string;
    page_title: string;
    body_snippet: string;
  };
}

const RESULTS_DIR = path.join(process.cwd(), 'test-results');

function writeResult(result: PlatformResult) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULTS_DIR, `${result.platform}-result.json`),
    JSON.stringify(result, null, 2)
  );
}

// ── Collect diagnostics from current page ──
async function collectDiagnostics(page: Page): Promise<{ final_url: string; page_title: string; body_snippet: string }> {
  let final_url = '';
  let page_title = '';
  let body_snippet = '';
  try {
    final_url = page.url();
  } catch { /* ignore */ }
  try {
    page_title = await page.title();
  } catch { /* ignore */ }
  try {
    const text = await page.locator('body').innerText({ timeout: 3000 });
    // First 500 chars, cleaned up
    body_snippet = text.replace(/\s+/g, ' ').trim().substring(0, 500);
  } catch { /* ignore */ }
  return { final_url, page_title, body_snippet };
}

// ── Cloudflare detection ──
async function detectCloudflare(page: Page): Promise<boolean> {
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 3000 });
    const cfIndicators = [
      /performing security verification/i,
      /verify you are human/i,
      /just a moment/i,
      /checking your browser/i,
      /cloudflare/i,
    ];
    const hits = cfIndicators.filter(p => p.test(bodyText));
    if (hits.length >= 2) return true;

    const hasTurnstile = await page.locator('iframe[src*="challenges.cloudflare.com"]').count();
    if (hasTurnstile > 0) return true;

    const hasCfWidget = await page.locator('.cf-turnstile, #cf-turnstile-container, [data-sitekey]').count();
    if (hasCfWidget > 0) return true;
  } catch { /* ignore */ }
  return false;
}

// ── Brand detection (NEW in v3.2) ──
// If the page content contains the platform's brand name/keywords,
// the platform is alive even if we can't find specific UI elements.
function getBrandKeywords(platform: string): RegExp[] {
  switch (platform) {
    case 'ChatGPT':
      return [
        /chatgpt/i,
        /openai/i,
        /ask anything/i,
        /what.*on the agenda/i,
      ];
    case 'Claude':
      return [
        /claude/i,
        /anthropic/i,
      ];
    case 'DeepSeek':
      return [
        /deepseek/i,
        /deep\s*seek/i,
      ];
    case 'Grok':
      return [
        /\bgrok\b/i,
        /\bx\.ai\b/i,
        /\bxai\b/i,
      ];
    case 'Perplexity':
      return [
        /perplexity/i,
        /where knowledge begins/i,
      ];
    case 'Gemini':
      return [
        /gemini/i,
        /google/i,
      ];
    default:
      return [];
  }
}

async function detectBrand(page: Page, platformName: string): Promise<boolean> {
  try {
    // Check page title
    const title = await page.title();
    const keywords = getBrandKeywords(platformName);
    for (const kw of keywords) {
      if (kw.test(title)) {
        console.log(`🏷️ ${platformName}: Brand detected in title: "${title}"`);
        return true;
      }
    }

    // Check body text
    const bodyText = await page.locator('body').innerText({ timeout: 3000 });
    const hits = keywords.filter(kw => kw.test(bodyText));
    if (hits.length >= 1) {
      console.log(`🏷️ ${platformName}: Brand detected in page content (${hits.length} keyword hits)`);
      return true;
    }

    // Check meta tags
    const metaContent = await page.evaluate(() => {
      const metas = document.querySelectorAll('meta[name], meta[property]');
      return Array.from(metas).map(m => m.getAttribute('content') || '').join(' ');
    });
    for (const kw of keywords) {
      if (kw.test(metaContent)) {
        console.log(`🏷️ ${platformName}: Brand detected in meta tags`);
        return true;
      }
    }
  } catch { /* ignore */ }
  return false;
}

// ── Login wall detection ──
const LOGIN_WALL_PATTERNS = [
  /log\s*in/i,
  /sign\s*in/i,
  /anmelden/i,
  /einloggen/i,
  /create.*account/i,
  /sign\s*up.*free/i,
  /welcome back/i,
  /continue with google/i,
  /continue with apple/i,
  /continue with microsoft/i,
  /SSO/,
  /log in with google/i,
  /login with apple/i,
  /forgot.?password/i,
  /phone number/i,
];

const LOGIN_URL_PATTERNS = [
  /\/login/i,
  /\/auth/i,
  /\/sign.?in/i,
  /accounts\.google/i,
  /\/sso/i,
];

async function detectLoginWall(page: Page, platformName: string): Promise<boolean> {
  const url = page.url();

  for (const pattern of LOGIN_URL_PATTERNS) {
    if (pattern.test(url)) {
      console.log(`🔒 ${platformName}: Login URL detected: ${url}`);
      return true;
    }
  }

  // Password input = very strong signal
  try {
    const hasPasswordInput = await page.locator('input[type="password"]').count();
    if (hasPasswordInput > 0) {
      console.log(`🔒 ${platformName}: Password input found — login page`);
      return true;
    }
  } catch { /* ignore */ }

  try {
    const bodyText = await page.locator('body').innerText({ timeout: 5000 });
    const loginHits = LOGIN_WALL_PATTERNS.filter(p => p.test(bodyText));

    if (loginHits.length >= 2) {
      const hasChatInput = await page.locator(
        'textarea:visible, div[contenteditable="true"][role="textbox"]:visible, rich-textarea:visible'
      ).first().isVisible({ timeout: 2000 }).catch(() => false);

      if (!hasChatInput) {
        console.log(`🔒 ${platformName}: Login wall detected (${loginHits.length} indicators, no chat input)`);
        return true;
      }
    }
  } catch { /* ignore */ }

  return false;
}

// ── Login page selectors (proves platform alive behind auth) ──
function getLoginPageSelectors(platform: string): string[] {
  switch (platform) {
    case 'ChatGPT':
      return ['button:has-text("Log in")', 'button:has-text("Sign up")'];
    case 'Claude':
      return ['input[placeholder*="email" i]', 'button:has-text("Continue with Google")', 'button:has-text("Continue with email")'];
    case 'DeepSeek':
      return ['input[placeholder*="Phone" i]', 'input[placeholder*="email" i]', 'input[type="password"]', '.ds-input__input', 'button:has-text("Log in")'];
    case 'Grok':
      return ['button:has-text("Sign in")', 'a:has-text("Sign in")'];
    case 'Perplexity':
      return ['button:has-text("Sign In")', 'button:has-text("Sign Up")'];
    case 'Gemini':
      return ['button:has-text("Sign in")'];
    default:
      return [];
  }
}

// ── Chat input selectors (proves full access) ──
function getChatSelectors(platform: string): string[] {
  switch (platform) {
    case 'ChatGPT':
      return [
        'div#prompt-textarea',                       // ProseMirror contenteditable div
        'div.ProseMirror[contenteditable="true"]',   // ProseMirror class
        'div[contenteditable="true"][role="textbox"]', // generic contenteditable
        'nav[aria-label="Chat history"]',            // sidebar
      ];
    case 'Claude':
      return [
        'div[contenteditable="true"]',
        'fieldset div[contenteditable="true"]',
        '[data-testid="composer-input"]',
      ];
    case 'Grok':
      return [
        'textarea[aria-label="Ask Grok anything"]',
        'textarea[placeholder="What do you want to know?"]',
        'textarea[placeholder]',
      ];
    case 'Gemini':
      return [
        'rich-textarea',
        '.ql-editor[contenteditable]',
        'bard-sidenav',
      ];
    case 'Perplexity':
      return [
        'div[role="textbox"][contenteditable="true"]',
        '.ProseMirror[contenteditable="true"]',
        'nav[aria-label="Main"]',
      ];
    case 'DeepSeek':
      return [
        'textarea#chat-input',
        '#ds-chat-input',
        'textarea[placeholder]',
      ];
    default:
      return [];
  }
}

test.describe('Platform Health Checks', () => {

  const platforms = [
    { name: 'ChatGPT',    url: 'https://chatgpt.com' },
    { name: 'Claude',     url: 'https://claude.ai' },
    { name: 'Grok',       url: 'https://grok.com' },
    { name: 'Gemini',     url: 'https://gemini.google.com' },
    { name: 'Perplexity', url: 'https://www.perplexity.ai' },
    { name: 'DeepSeek',   url: 'https://chat.deepseek.com' },
  ];

  for (const platform of platforms) {
    test(`${platform.name} - health check`, async ({ page }) => {
      const startTime = Date.now();

      try {
        console.log(`🚀 Checking ${platform.name} (${platform.url})...`);

        const response = await page.goto(platform.url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        if (response && response.status() >= 500) {
          throw Object.assign(new Error(`HTTP ${response.status()}`), { category: 'network_error' });
        }

        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

        // Extra wait for JS-triggered redirects
        await page.waitForTimeout(2000);

        const diag = await collectDiagnostics(page);
        console.log(`📍 ${platform.name}: URL=${diag.final_url} | Title="${diag.page_title}" | Body[0:80]="${diag.body_snippet.substring(0, 80)}"`);

        // ── TIER 1: Cloudflare ──
        const isCloudflare = await detectCloudflare(page);
        if (isCloudflare) {
          console.log(`☁️ ${platform.name}: Cloudflare challenge — platform alive`);
          writeResult({
            platform: platform.name.toLowerCase(),
            status: 'cloudflare',
            error_message: `Cloudflare challenge at ${diag.final_url}`,
            error_category: 'cloudflare',
            response_time_ms: Date.now() - startTime,
            diagnostics: diag,
          });
          return;
        }

        // ── TIER 2: Brand Detection (NEW) ──
        // If we can see the brand name, the platform served us a page — it's alive
        const hasBrand = await detectBrand(page, platform.name);

        // ── TIER 3: Login Wall ──
        const isLoginWall = await detectLoginWall(page, platform.name);
        if (isLoginWall) {
          const loginSelectors = getLoginPageSelectors(platform.name);
          let loginPageConfirmed = false;
          for (const sel of loginSelectors) {
            try {
              await expect(page.locator(sel).first()).toBeVisible({ timeout: 5000 });
              loginPageConfirmed = true;
              break;
            } catch { /* try next */ }
          }

          console.log(`🔒 ${platform.name}: Login wall — confirmed: ${loginPageConfirmed}`);
          writeResult({
            platform: platform.name.toLowerCase(),
            status: 'login_wall',
            error_message: `Login required at ${diag.final_url}`,
            error_category: 'login_wall',
            response_time_ms: Date.now() - startTime,
            diagnostics: diag,
          });
          return;
        }

        // ── TIER 4: Chat Input Selectors ──
        const chatSelectors = getChatSelectors(platform.name);
        let chatFound = false;

        for (const selector of chatSelectors) {
          try {
            await expect(page.locator(selector).first()).toBeVisible({ timeout: 12000 });
            console.log(`✅ ${platform.name}: Chat input found with "${selector}"`);
            chatFound = true;
            break;
          } catch { /* try next */ }
        }

        if (chatFound) {
          writeResult({
            platform: platform.name.toLowerCase(),
            status: 'ok',
            response_time_ms: Date.now() - startTime,
            diagnostics: diag,
          });
          return;
        }

        // ── TIER 5: Brand fallback ──
        // No interactive elements found, but brand is present → platform is alive
        if (hasBrand) {
          console.log(`🏷️ ${platform.name}: No selectors matched, but brand detected — platform alive`);
          writeResult({
            platform: platform.name.toLowerCase(),
            status: 'brand_detected',
            error_message: `Brand visible but no interactive elements at ${diag.final_url}`,
            error_category: 'brand_detected',
            response_time_ms: Date.now() - startTime,
            diagnostics: diag,
          });
          return; // Test PASSES — brand means platform is alive
        }

        // ── TIER 6: Nothing matched ──
        const diagMsg = `No selectors found after ${Date.now() - startTime}ms | URL: ${diag.final_url} | Title: "${diag.page_title}" | Body: "${diag.body_snippet.substring(0, 200)}"`;
        throw Object.assign(new Error(diagMsg), { category: 'selector_not_found' });

      } catch (e: any) {
        const elapsed = Date.now() - startTime;
        const errorCategory = e.category || categorizeError(e.message || '');
        const errorMessage = (e.message || 'Unknown error').slice(0, 800);

        // Collect diagnostics even on error
        let diag = { final_url: '', page_title: '', body_snippet: '' };
        try { diag = await collectDiagnostics(page); } catch { /* ignore */ }

        writeResult({
          platform: platform.name.toLowerCase(),
          status: 'failed',
          error_message: errorMessage,
          error_category: errorCategory,
          response_time_ms: elapsed,
          diagnostics: diag,
        });
        console.log(`📝 Result: ${platform.name} = failed [${errorCategory}]`);
        console.log(`🔍 Diagnostics: ${JSON.stringify(diag)}`);

        try {
          await page.screenshot({
            path: `test-results/${platform.name.toLowerCase()}-failure.png`,
            fullPage: true,
          });
        } catch {
          console.warn(`⚠️ Screenshot failed for ${platform.name}`);
        }

        throw new Error(`${platform.name} check failed [${errorCategory}]: ${errorMessage}`);
      }
    });
  }

  test.afterAll(async () => {
    try {
      const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('-result.json'));
      const merged: PlatformResult[] = [];

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(RESULTS_DIR, file), 'utf-8');
          merged.push(JSON.parse(content));
        } catch {
          console.warn(`⚠️ Could not read ${file}`);
        }
      }

      fs.writeFileSync(
        path.join(RESULTS_DIR, 'platform-results.json'),
        JSON.stringify(merged, null, 2)
      );
      console.log(`\n📊 Merged ${merged.length} results into platform-results.json`);
      console.log(JSON.stringify(merged, null, 2));
    } catch (e) {
      console.warn('⚠️ Could not merge results:', e);
    }
  });
});

function categorizeError(message: string): string {
  if (/timeout|exceeded/i.test(message)) return 'timeout';
  if (/selector|locator.*not found|no matching/i.test(message)) return 'selector_not_found';
  if (/net::ERR|ECONNREFUSED|network|connection refused|HTTP [45]/i.test(message)) return 'network_error';
  if (/login|sign.?in|auth|redirect.*login/i.test(message)) return 'login_wall';
  if (/cloudflare|security verification|verify.*human/i.test(message)) return 'cloudflare';
  return 'unknown';
}
