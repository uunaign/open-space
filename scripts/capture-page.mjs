import { chromium } from 'playwright';

const rawUrl = process.argv[2];

const launchBrowser = async () => {
  const errors = [];
  try {
    return await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--hide-scrollbars'] });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  for (const channel of ['msedge', 'chrome', 'chromium']) {
    try {
      return await chromium.launch({
        channel,
        headless: true,
        args: ['--disable-dev-shm-usage', '--hide-scrollbars'],
      });
    } catch (error) {
      errors.push(`${channel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`No se encontró un navegador Chromium disponible. Instala Chromium con “npx playwright install chromium” o instala Chrome/Edge. ${errors[0] ?? ''}`);
};

const waitForPageReady = async (page, timeout = 22000) => {
  const result = await page.evaluate(async (maxWait) => {
    const busySelectors = [
      '[aria-busy="true"]',
      '[role="progressbar"]',
      '[class*="skeleton" i]',
      '[class*="spinner" i]',
      '[class*="loading-overlay" i]',
      '[class*="loader" i]',
    ];
    const started = Date.now();
    let lastSignature = '';
    let stableMs = 0;

    const getState = () => {
      const body = document.body;
      if (!body) return { signature: 'no-body', busyCount: 1, hasContent: false };
      const text = (body.innerText ?? '').replace(/\s+/g, ' ').trim();
      const visibleBusy = Array.from(document.querySelectorAll(busySelectors.join(','))).filter((element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.08 && rect.width > 28 && rect.height > 20;
      });
      const loadingCopy = /^(loading(?:\.\.\.)?|please wait|cargando(?:\.\.\.)?|un momento|preparando página|preparing page)$/i.test(text);
      const visibleMedia = Array.from(document.querySelectorAll('img, video, canvas, svg')).filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 24 && rect.height > 24;
      }).length;
      const height = Math.max(document.documentElement.scrollHeight, body.scrollHeight);
      const width = Math.max(document.documentElement.scrollWidth, body.scrollWidth);
      const signature = [
        document.readyState,
        text.length,
        text.slice(0, 420),
        text.slice(-240),
        height,
        width,
        document.images.length,
        Array.from(document.images).filter((image) => image.complete && image.naturalWidth > 0).length,
        visibleMedia,
        Math.max(visibleBusy.length, loadingCopy ? 1 : 0),
      ].join('|');

      return { signature, busyCount: Math.max(visibleBusy.length, loadingCopy ? 1 : 0), hasContent: text.length > 24 || visibleMedia > 0 };
    };

    return await new Promise((resolve) => {
      const poll = window.setInterval(() => {
        const state = getState();
        if (state.signature === lastSignature && state.busyCount === 0 && state.hasContent) stableMs += 500;
        else stableMs = 0;
        lastSignature = state.signature;

        if (stableMs >= 2500) {
          window.clearInterval(poll);
          resolve({ ready: true, busyCount: 0 });
        } else if (Date.now() - started >= maxWait) {
          window.clearInterval(poll);
          resolve({ ready: false, busyCount: state.busyCount });
        }
      }, 500);
    });
  }, timeout);

  if (!result.ready) {
    if (result.busyCount > 0) {
      throw new Error('La página sigue mostrando una animación o un indicador de carga. No se ha guardado una captura incompleta.');
    }
    throw new Error('La página no terminó de mostrar su contenido. Espera a que cargue y vuelve a intentarlo.');
  }
};

const assertNoAccessChallenge = async (page) => {
  const challenge = await page.evaluate(() => {
    const selectors = [
      '.g-recaptcha',
      '[data-sitekey]',
      '.cf-turnstile',
      'iframe[src*="captcha" i]',
      'iframe[src*="recaptcha" i]',
      'iframe[src*="challenges.cloudflare.com" i]',
      '#challenge-form',
      '#cf-challenge-running',
      'form[action*="challenge" i]',
    ];
    const visible = Array.from(document.querySelectorAll(selectors.join(','))).some((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 12 && rect.height > 12;
    });
    const title = document.title.toLowerCase();
    const text = (document.body?.innerText ?? '').toLowerCase();
    const challengeCopy = /verify you are human|checking your browser|complete the captcha|complete the security check|verifica que eres humano|completa el captcha/.test(text);
    return visible || /just a moment|security check|attention required/.test(title) || (challengeCopy && text.length < 5000);
  });

  if (challenge) {
    throw new Error('El sitio solicita un CAPTCHA o una verificación de acceso. No se ha guardado la pantalla de verificación.');
  }
};

if (!rawUrl) {
  console.error('Falta la URL de la página.');
  process.exit(1);
}

const main = async () => {
  let targetUrl;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    throw new Error('La URL de la página no es válida.');
  }

  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    throw new Error('Solo se pueden capturar páginas HTTP o HTTPS.');
  }

  const browser = await launchBrowser();

  try {
    const page = await browser.newPage({
      // Keep the source site at a genuine desktop breakpoint. The canvas can
      // scale the resulting webclip independently after it has been captured.
      viewport: { width: 1440, height: 1100 },
      deviceScaleFactor: 2,
      screen: { width: 1440, height: 1100 },
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
    });
    page.setDefaultNavigationTimeout(45000);
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.addInitScript(() => {
      const hideConsentPrompts = () => {
        document
          .querySelectorAll('[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i]')
          .forEach((element) => {
            if (element instanceof HTMLElement) {
              element.remove();
            }
          });
      };

      document.addEventListener('DOMContentLoaded', hideConsentPrompts, { once: true });
      new MutationObserver(hideConsentPrompts).observe(document, { childList: true, subtree: true });
    });

    await page.goto(targetUrl.href, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      document.querySelectorAll('img[loading="lazy"]').forEach((image) => {
        image.setAttribute('loading', 'eager');
      });
    });

    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    await waitForPageReady(page);
    await assertNoAccessChallenge(page);
    // Visit the whole document once so native lazy-loading and scroll-triggered
    // sections have a chance to enter the page before the full-page snapshot.
    await page.evaluate(async () => {
      let previousHeight = 0;
      let stablePasses = 0;
      let y = 0;
      while (stablePasses < 3 && y < 30000) {
        const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        if (height === previousHeight && y >= height) stablePasses += 1;
        else stablePasses = 0;
        previousHeight = height;
        window.scrollTo(0, Math.min(y, Math.max(height - window.innerHeight, 0)));
        await new Promise((resolve) => window.setTimeout(resolve, 120));
        y += 850;
      }
      window.scrollTo(0, 0);
    });
    await Promise.race([
      page.evaluate(() => Promise.all(Array.from(document.images, (image) => image.decode().catch(() => undefined)))),
      page.waitForTimeout(5000),
    ]);
    await Promise.race([
      page.evaluate(() => document.fonts.ready),
      page.waitForTimeout(1500),
    ]);
    await waitForPageReady(page);
    await assertNoAccessChallenge(page);

    const image = await page.screenshot({
      fullPage: true,
      type: 'jpeg',
      quality: 88,
      animations: 'disabled',
      caret: 'hide',
    });

    if (image.length === 0) {
      throw new Error('Chromium devolvió una captura vacía.');
    }

    process.stdout.write(image.toString('base64'));
  } finally {
    await browser.close();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
