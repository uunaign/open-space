import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2];

if (!url) {
  console.error('Falta la URL');
  process.exit(1);
}

const main = async () => {
  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage({
    viewport: { width: 1600, height: 2200 },
    deviceScaleFactor: 2,
    screen: { width: 1600, height: 2200 },
    ignoreHTTPSErrors: true,
    javaScriptEnabled: true,
  });

  await page.addInitScript(() => {
    const removeNoise = () => {
      const selectors = [
        '[id*="cookie"]',
        '[class*="cookie"]',
        '[id*="consent"]',
        '[class*="consent"]',
        '[id*="ads"]',
        '[class*="ads"]',
        '[id*="banner"]',
        '[class*="banner"]',
        '[role="dialog"]',
      ];

      for (const selector of selectors) {
        document.querySelectorAll(selector).forEach((node) => {
          const element = node;
          if (element instanceof HTMLElement) {
            element.style.display = 'none';
            element.style.visibility = 'hidden';
            element.remove();
          }
        });
      }
    };

    const observer = new MutationObserver(() => removeNoise());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    removeNoise();
  });

  try {
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    await page.waitForTimeout(1200);

    const imagePath = path.join(process.cwd(), 'tmp-page-capture.png');
    await page.screenshot({
      path: imagePath,
      fullPage: true,
      type: 'png',
    });

    const buffer = fs.readFileSync(imagePath);
    process.stdout.write(buffer.toString('base64'));
    fs.unlinkSync(imagePath);
  } finally {
    await browser.close();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
