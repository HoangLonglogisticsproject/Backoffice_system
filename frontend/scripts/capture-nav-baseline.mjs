/**
 * Phase 8 baseline capture — READ ONLY.
 *
 * Drives the running dev server with the puppeteer-core already in
 * devDependencies. Writes screenshots + a machine-readable measurement dump so
 * the navigation refactor can be diffed against numbers, not impressions.
 *
 * Nothing here touches source. Run:
 *   node scripts/capture-nav-baseline.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ORIGIN = 'http://localhost:4200';
const OUT = join(process.cwd(), '..', '__screenshots__', 'phase-8-baseline');

/** The three acceptance personas. */
const PERSONAS = [
  { id: 'u-ceo', slug: 'superadmin', label: 'Vương Nguyên Hảo · SUPERADMIN' },
  { id: 'u-head-sales', slug: 'head-sales', label: 'Huyền Trang · DEPARTMENT_HEAD' },
  { id: 'u-sales-a', slug: 'member', label: 'Sales A · MEMBER' },
];

/**
 * Viewport → layout is decided by Viewport (max-width 899 / 1279), so each
 * width activates exactly ONE mode. There is no persona that shows a rail at
 * 1440; recording it as "n/a" is the honest answer.
 */
const VIEWPORTS = [
  { w: 1440, h: 900, mode: 'full' },
  { w: 1024, h: 800, mode: 'rail' },
  { w: 390, h: 844, mode: 'drawer' },
];

const px = (v) => (v === null || v === undefined ? null : v);

/** Everything measured inside the page, in one pass. */
function measure() {
  const get = (el, ...props) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const out = {};
    for (const p of props) out[p] = cs.getPropertyValue(p).trim();
    return out;
  };
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
  };
  const root = getComputedStyle(document.documentElement);
  const token = (n) => root.getPropertyValue(n).trim() || null;

  const sidebar = document.querySelector('bo-navigation-sidebar, bo-sidebar');
  const topbar = document.querySelector('bo-topbar');
  const rows = [...document.querySelectorAll('.nav__row')];
  const current = document.querySelector('[aria-current="page"]');
  const section = document.querySelector('.nav__section');
  const icon = document.querySelector('.nav__row svg');
  const brandMark = document.querySelector('.brand__mark');

  // Active-state geometry lives on a ::before pseudo element.
  const marker = current
    ? (() => {
        const cs = getComputedStyle(current, '::before');
        return {
          width: cs.width,
          height: cs.height,
          borderRadius: cs.borderRadius,
          background: cs.backgroundColor,
          left: cs.left,
        };
      })()
    : null;

  return {
    tokens: {
      '--nav-w': token('--nav-w'),
      '--nav-rail-w': token('--nav-rail-w'),
      '--nav-surface': token('--nav-surface'),
      '--nav-fg': token('--nav-fg'),
      '--nav-fg-muted': token('--nav-fg-muted'),
      '--nav-icon': token('--nav-icon'),
      '--nav-section-fg': token('--nav-section-fg'),
      '--nav-hover': token('--nav-hover'),
      '--nav-line': token('--nav-line'),
      '--nav-spine': token('--nav-spine'),
      '--nav-slot-fg': token('--nav-slot-fg'),
      '--nav-accent-ink': token('--nav-accent-ink'),
      '--nav-ring': token('--nav-ring'),
      '--line-chrome': token('--line-chrome'),
      '--c-primary': token('--c-primary'),
      '--f-sans': token('--f-sans'),
      '--control-h': token('--control-h'),
      '--topbar-h': token('--topbar-h'),
    },
    sidebar: {
      rect: rect(sidebar),
      hasRailClass: sidebar?.classList.contains('rail') ?? null,
      hasOpenClass: sidebar?.classList.contains('open') ?? null,
      style: get(sidebar, 'background-color', 'border-right', 'position', 'overflow-y', 'z-index'),
    },
    topbar: { rect: rect(topbar) },
    row: {
      count: rows.length,
      first: rect(rows[0]),
      style: get(
        rows[0],
        'height',
        'padding-inline-start',
        'gap',
        'border-radius',
        'color',
        'font-size',
        'font-weight',
        'letter-spacing',
      ),
      /** Child rows sit at a deeper indent; capture the distinct set. */
      indents: [...new Set(rows.map((r) => getComputedStyle(r).paddingInlineStart))],
      heights: [...new Set(rows.map((r) => +r.getBoundingClientRect().height.toFixed(2)))],
    },
    section: {
      style: get(
        section,
        'font-size',
        'font-weight',
        'letter-spacing',
        'text-transform',
        'color',
        'margin-bottom',
        'padding-inline-start',
      ),
    },
    icon: {
      rect: rect(icon),
      strokeWidth: icon?.getAttribute('stroke-width') ?? null,
      stroke: icon ? getComputedStyle(icon).stroke : null,
    },
    brandMark: {
      rect: rect(brandMark),
      style: get(brandMark, 'border-radius', 'background-color', 'font-size', 'font-weight'),
    },
    active: {
      present: !!current,
      count: document.querySelectorAll('[aria-current="page"]').length,
      href: current?.getAttribute('href') ?? null,
      style: get(current, 'color', 'font-weight', 'background-color'),
      marker,
    },
    overflow: {
      sidebarScrollH: sidebar?.scrollHeight ?? null,
      sidebarClientH: sidebar?.clientHeight ?? null,
      overflowing: sidebar ? sidebar.scrollHeight > sidebar.clientHeight : null,
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    },
  };
}

const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
});

await mkdir(OUT, { recursive: true });
const report = { capturedAt: new Date().toISOString(), origin: ORIGIN, entries: [] };
const consoleErrors = [];

for (const persona of PERSONAS) {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`${persona.slug}/${vp.w}: ${m.text()}`);
    });
    page.on('pageerror', (e) => consoleErrors.push(`${persona.slug}/${vp.w}: ${e.message}`));

    // Pick the persona the way the app itself does, before the app boots.
    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
    await page.evaluate((id) => sessionStorage.setItem('bo.demo.persona', id), persona.id);
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
    await settle();

    const name = `${persona.slug}-${vp.w}-${vp.mode}`;
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
    const m = await page.evaluate(measure);
    report.entries.push({ persona: persona.label, slug: persona.slug, viewport: vp, mode: vp.mode, route: '/', shot: `${name}.png`, measurements: m });

    // Drawer only exists below 900px; open it and capture the second state.
    if (vp.mode === 'drawer') {
      const opened = await page.evaluate(() => {
        const btn = document.querySelector('bo-topbar button');
        if (!btn) return false;
        btn.click();
        return true;
      });
      if (opened) {
        await settle(500);
        await page.screenshot({ path: join(OUT, `${name}-open.png`) });
        const mo = await page.evaluate(measure);
        const trap = await page.evaluate(() => {
          const sb = document.querySelector('bo-navigation-sidebar, bo-sidebar');
          return {
            role: sb?.getAttribute('role') ?? null,
            ariaModal: sb?.getAttribute('aria-modal') ?? null,
            ariaLabel: sb?.getAttribute('aria-label') ?? null,
            scrimPresent: !!document.querySelector('.scrim'),
            focusInsideDrawer: !!(document.activeElement && sb?.contains(document.activeElement)),
            activeElement: document.activeElement?.tagName ?? null,
          };
        });
        report.entries.push({ persona: persona.label, slug: persona.slug, viewport: vp, mode: 'drawer-open', route: '/', shot: `${name}-open.png`, measurements: mo, drawer: trap });

        // Escape must close it and hand focus back to the trigger.
        await page.keyboard.press('Escape');
        await settle(500);
        const afterEscape = await page.evaluate(() => ({
          open: document.querySelector('bo-navigation-sidebar, bo-sidebar')?.classList.contains('open') ?? null,
          scrimPresent: !!document.querySelector('.scrim'),
          activeElement: document.activeElement?.tagName ?? null,
          activeLabel: document.activeElement?.getAttribute('aria-label') ?? null,
        }));
        report.entries.at(-1).escape = afterEscape;
      }
    }

    await page.close();
  }
}

// --- keyboard behaviour, measured once at the widest layout ------------------
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
  await page.evaluate((id) => sessionStorage.setItem('bo.demo.persona', id), 'u-ceo');
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
  await settle();

  const read = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      return { tag: el?.tagName ?? null, text: (el?.textContent ?? '').trim().slice(0, 40) };
    });

  await page.evaluate(() => document.querySelector('.nav__row')?.focus());
  const start = await read();
  await page.keyboard.press('ArrowDown');
  const afterDown = await read();
  await page.keyboard.press('ArrowUp');
  const afterUp = await read();
  await page.keyboard.press('End');
  const afterEnd = await read();
  await page.keyboard.press('Home');
  const afterHome = await read();

  report.keyboard = { start, afterDown, afterUp, afterEnd, afterHome };
  await page.close();
}

// --- every route still resolves ---------------------------------------------
{
  const ROUTES = ['/', '/my-work', '/departments', '/departments/sales', '/requests', '/approvals', '/documents', '/reports', '/ai', '/activity', '/settings', '/no-access'];
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
  await page.evaluate((id) => sessionStorage.setItem('bo.demo.persona', id), 'u-ceo');
  const routes = [];
  for (const r of ROUTES) {
    await page.goto(`${ORIGIN}${r}`, { waitUntil: 'networkidle0' });
    await settle(450);
    routes.push(
      await page.evaluate(
        (route) => ({
          route,
          landedOn: location.pathname,
          title: document.querySelector('h1')?.textContent?.trim() ?? null,
          ariaCurrentCount: document.querySelectorAll('[aria-current="page"]').length,
        }),
        r,
      ),
    );
  }
  report.routes = routes;
  await page.close();
}

report.consoleErrors = consoleErrors;
await writeFile(join(OUT, 'measurements.json'), JSON.stringify(report, null, 2), 'utf8');
await browser.close();

console.log(`baseline written to ${OUT}`);
console.log(`entries: ${report.entries.length}  routes: ${report.routes.length}  consoleErrors: ${consoleErrors.length}`);
