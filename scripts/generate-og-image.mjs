/**
 * Generates og-image.png from og-image.html using Playwright.
 * Run: npx playwright install chromium && node scripts/generate-og-image.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, '../public/og-image.html');
const outputPath = path.resolve(__dirname, '../public/og-image.png');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1200, height: 630 });
await page.goto(`file://${htmlPath}`);
// Wait for font to load
await page.waitForTimeout(1500);
await page.screenshot({ path: outputPath, type: 'png' });
await browser.close();

console.log(`OG image saved to: ${outputPath}`);
