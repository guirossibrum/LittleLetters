/* Run with Playwright installed (no app dependencies are needed):
   NODE_PATH=/path/to/node_modules node tests/browser.cjs
   Optional: CHROMIUM_PATH=/path/to/chromium, CHECK_OUTPUT=/tmp/little-letters-check
   Tests use an isolated native helper, block external requests, and also verify standalone file printing. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { spawn, execFileSync } = require('node:child_process');
const { createInterface } = require('node:readline');

(async () => {
  const output = process.env.CHECK_OUTPUT || '/tmp/little-letters-check';
  await fs.mkdir(output, { recursive: true });
  const nativeOutput = path.join(output, 'native-exports');
  await fs.mkdir(nativeOutput, { recursive: true });
  const helper = spawn('/usr/bin/python3', ['-B', path.join(__dirname, 'native_server.py'), nativeOutput], { stdio: ['ignore', 'pipe', 'inherit'] });
  const ready = createInterface({ input: helper.stdout });
  const address = await new Promise((resolve, reject) => {
    ready.once('line', line => resolve(JSON.parse(line).url));
    helper.once('exit', code => reject(new Error(`Native test server exited: ${code}`)));
  });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.context().route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname === '127.0.0.1' || url.protocol === 'file:' ? route.continue() : route.abort();
    });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(address);
    await page.waitForSelector('#sheet svg');
    const openPDF = async (filename, expectedPages) => {
      const previous = new Set(await fs.readdir(nativeOutput));
      await page.locator('#open-pdf').click();
      await page.waitForFunction(() => document.querySelector('#feedback').textContent === 'PDF opened in your document viewer.');
      const created = (await fs.readdir(nativeOutput)).filter(name => name.endsWith('.pdf') && !previous.has(name));
      assert.equal(created.length, 1);
      const pdf = await fs.readFile(path.join(nativeOutput, created[0]));
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      const info = execFileSync('pdfinfo', [path.join(nativeOutput, created[0])], { encoding: 'utf8' });
      assert.match(info, new RegExp(`Pages:\\s+${expectedPages}\\b`));
      await fs.writeFile(path.join(output, filename), pdf);
    };
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    assert.match(await page.locator('#page-count').innerText(), /Page 1 of 1/);
    assert.equal(await page.locator('#sheet .row-trace').count(), 4);
    assert.equal(await page.locator('#sheet .row-blank').count(), 4);
    assert.equal(await page.locator('#sheet text').filter({ hasText: /^(Look|Trace|Try)$/ }).count(), 0);
    const writingLine = await page.locator('#sheet path[stroke="#93b3ca"]').first().getAttribute('d');
    assert.match(writingLine, /^M16 /, 'Writing begins at the page margin without a label column');
    assert.equal(Number(writingLine.split('h')[1]), 183.9, 'US Letter writing rows use the full width between 16 mm margins');
    assert.ok(await page.locator('#sheet path[stroke-dasharray=".01 1.6"]').count() > 0, 'Block tracing uses dotted centerlines');
    assert.equal(await page.locator('#script-font-field').isVisible(), false);

    await page.locator('[data-preset="pairs"]').click();
    assert.equal(await page.locator('#content').inputValue(), Array.from('abcdefghijklmnopqrstuvwxyz', c => `${c.toUpperCase()} ${c}`).join('\n'));
    assert.match(await page.locator('#page-count').innerText(), /of 13$/);
    await page.locator('#next').click();
    assert.match(await page.locator('#page-count').innerText(), /Page 2 of 13/);
    assert.ok((await page.locator('#sheet').innerText()).includes('C c'));

    // Printing includes all pages, with exact paper dimensions and embedded fonts.
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.equal(await page.locator('#print-sheets .print-page').count(), 13);
    await page.pdf({ path: path.join(output, 'alphabet.pdf'), preferCSSPageSize: true, printBackground: true });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await openPDF('opened-alphabet.pdf', 13);

    await page.locator('#exercise').selectOption('name');
    await page.waitForSelector('.sheet-empty');
    assert.equal(await page.locator('#print').isDisabled(), true);
    await page.locator('#content').fill('Practice');
    await page.waitForSelector('#sheet svg');
    assert.equal(await page.locator('#sheet .row-trace').count(), 2);
    assert.equal(await page.locator('#sheet .row-blank').count(), 8, 'Name practice fills the full page with writing lines');
    const lastBaseline = await page.locator('#sheet path[stroke="#93b3ca"]').last().getAttribute('d');
    assert.ok(Number(lastBaseline.split(' ')[1]) > 239, 'Practice lines reach the bottom of US Letter');
    await page.locator('#student').fill('<Example & Text>');
    await page.waitForFunction(() => document.querySelector('#sheet svg').textContent.includes('<Example & Text>'));
    assert.equal(await page.locator('#sheet svg script').count(), 0);

    // Accented letters retain the same centerline, size, and advance as the base letter.
    await page.locator('#content').fill('Word Box');
    await page.waitForFunction(() => document.querySelector('#sheet svg').textContent.includes('Word Box'));
    const plainB = await page.evaluate(() => Array.from(document.querySelectorAll('#sheet path')).find(p => p.getAttribute('d') === window.BlockGlyphs.B[1]).getAttribute('transform'));
    await page.locator('#content').fill('Wórd Box');
    await page.waitForFunction(() => document.querySelector('#sheet svg').textContent.includes('Wórd Box'));
    const accented = await page.evaluate(() => {
      const paths = Array.from(document.querySelectorAll('#sheet path'));
      const glyph = window.BlockGlyphs['ó'];
      return {
        nextLetter: paths.find(p => p.getAttribute('d') === window.BlockGlyphs.B[1]).getAttribute('transform'),
        solid: paths.some(p => p.getAttribute('d') === glyph[1] && p.getAttribute('stroke-width') === '.55'),
        dotted: paths.some(p => p.getAttribute('d') === glyph[1] && p.getAttribute('stroke-dasharray') === '.01 1.6'),
        fallback: Array.from(document.querySelectorAll('#sheet text')).some(t => t.textContent === 'ó')
      };
    });
    assert.equal(accented.nextLetter, plainB, 'Accents preserve letter spacing');
    assert.equal(accented.solid, true, 'Accented examples use the same thin vector stroke');
    assert.equal(accented.dotted, true, 'Accented tracing uses dotted centerlines');
    assert.equal(accented.fallback, false, 'Accented letter never switches to the heavier fallback font');
    const composedSheet = await page.locator('#sheet').innerHTML();
    await page.locator('#content').fill('Wo\u0301rd Box');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#sheet').innerHTML(), composedSheet, 'Combining accents and precomposed letters render identically');
    await page.screenshot({ path: path.join(output, 'accented-block.png'), fullPage: true });
    await openPDF('opened-accented-block.pdf', 1);
    await page.locator('#content').fill('Practice');
    await page.waitForFunction(() => document.querySelector('#sheet svg').textContent.includes('Practice'));
    const repeatedPaths = await page.locator('#sheet path[stroke-dasharray=".01 1.6"]').count();
    await page.locator('#repeat').uncheck();
    await page.waitForTimeout(100);
    assert.ok(await page.locator('#sheet path[stroke-dasharray=".01 1.6"]').count() < repeatedPaths);

    await page.locator('input[value="script"]').check();
    await page.waitForSelector('#sheet text[stroke-dasharray=".01 .8"]');
    await page.screenshot({ path: path.join(output, 'calligraphy.png'), fullPage: true });
    await openPDF('opened-calligraphy.pdf', 1);

    // Every selected font renders accented names, traces, and embeds in its own offline PDF.
    assert.equal(await page.locator('#script-font-field').isVisible(), true);
    assert.deepEqual(await page.locator('#script-font option').allTextContents(), ['Allura', 'Italianno', 'Sacramento', 'Parisienne', 'Dancing Script', 'Great Vibes', 'Pinyon Script']);
    await page.locator('#content').fill('Wórd Box');
    await page.waitForFunction(() => document.querySelector('#sheet svg').textContent.includes('Wórd Box'));
    for (const [value, family] of [['allura', 'PracticeScript'], ['italianno', 'PracticeItalianno'], ['sacramento', 'PracticeSacramento'], ['parisienne', 'PracticeParisienne'], ['dancing', 'PracticeDancing'], ['greatvibes', 'PracticeGreatVibes'], ['pinyon', 'PracticePinyon']]) {
      await page.locator('#script-font').selectOption(value);
      await page.waitForFunction(family => document.querySelector('#sheet text[stroke-dasharray=".01 .8"]')?.getAttribute('font-family') === family, family);
      assert.equal(await page.evaluate(family => document.fonts.check(`20px ${family}`), family), true);
      assert.equal(await page.locator('#sheet text').filter({ hasText: /^Wórd Box$/ }).last().getAttribute('font-family'), family);
      await page.screenshot({ path: path.join(output, `font-${value}.png`), fullPage: true });
      await openPDF(`font-${value}.pdf`, 1);
    }
    await page.reload();
    await page.waitForSelector('#sheet svg');
    assert.equal(await page.locator('#script-font').inputValue(), 'pinyon', 'Font selection survives a reload');
    assert.equal(await page.locator('#sheet text[stroke-dasharray=".01 .8"]').first().getAttribute('font-family'), 'PracticePinyon');
    await page.locator('#script-font').selectOption('allura');
    await page.waitForFunction(() => document.querySelector('#sheet text[stroke-dasharray=".01 .8"]')?.getAttribute('font-family') === 'PracticeScript');
    await page.locator('#content').fill('Practice');
    await page.waitForFunction(() => document.querySelector('#sheet svg').textContent.includes('Practice'));

    await page.locator('#paper').selectOption('a4');
    await page.waitForFunction(() => document.querySelector('#sheet svg')?.getAttribute('height') === '297mm');
    await page.locator('#size').fill('16');
    await page.locator('#trace').selectOption('4');
    await page.locator('#blank').selectOption('4');
    await page.waitForTimeout(150);
    assert.match(await page.locator('#page-count').innerText(), /of 2$/);
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.equal(await page.locator('#print-sheets .print-page').count(), 2);
    assert.equal(await page.locator('#print-sheets .row-trace').count(), 4);
    assert.ok(await page.locator('#print-sheets .row-blank').count() >= 4);
    assert.equal(await page.locator('#print-sheets text').filter({ hasText: /^(Look|Trace|Try)$/ }).count(), 0);
    const a4Line = await page.locator('#sheet path[stroke="#93b3ca"]').first().getAttribute('d');
    assert.equal(Number(a4Line.split('h')[1]), 178, 'A4 writing rows also use the full width between margins');
    await page.pdf({ path: path.join(output, 'large-a4.pdf'), preferCSSPageSize: true, printBackground: true });
    await openPDF('opened-large-a4.pdf', 2);

    await page.locator('#exercise').selectOption('words');
    await page.locator('#content').fill('This is a very long sentence with letters that need to fit inside the worksheet without cutting off.\nSupercalifragilisticexpialidocious');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#feedback').innerText(), '');

    await page.locator('#guides').uncheck();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#sheet path[stroke="#c0d4e1"]').count(), 0);
    await page.locator('#exercise').selectOption('blank');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#trace').isDisabled(), true);
    assert.equal(await page.locator('#sheet .row-trace').count(), 0);
    await page.locator('#exercise').selectOption('strokes');
    await page.waitForTimeout(100);
    assert.ok((await page.locator('#sheet').innerText()).includes('Tall lines'));
    await page.locator('#reset').click();
    assert.equal(await page.locator('#script-font').inputValue(), 'allura');
    await page.locator('#content').fill('p g y q\n0123456789\na b c d e f g h i j k l m n o p q r s t u v w x y z');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(output, 'block-glyphs.png'), fullPage: true });

    // Stored settings survive a reload; malformed values cannot enter layout loops.
    await page.reload();
    await page.waitForSelector('#sheet svg');
    assert.ok((await page.locator('#content').inputValue()).includes('p g y q'));
    await page.evaluate(() => localStorage.setItem('little-letters-v1', JSON.stringify({ style: 'script', scriptFont: 'chancery', content: 'Safe' })));
    await page.reload();
    await page.waitForSelector('#sheet svg');
    assert.equal(await page.locator('#script-font').inputValue(), 'allura', 'Removed font preferences fall back to Allura');
    assert.equal(await page.locator('#sheet text[stroke-dasharray=".01 .8"]').first().getAttribute('font-family'), 'PracticeScript');
    await page.evaluate(() => localStorage.setItem('little-letters-v1', JSON.stringify({ style: 'invalid', size: -Infinity, trace: 100000, exercise: 'no-such-exercise', content: 'Safe' })));
    await page.reload();
    await page.waitForSelector('#sheet svg');
    assert.equal(await page.locator('#size').inputValue(), '8');
    assert.equal(await page.locator('#trace').inputValue(), '2');

    await page.locator('#reset').click();
    // Small screens retain usable controls without horizontal scrolling.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const standalone = await browser.newPage();
    await standalone.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await standalone.waitForSelector('#sheet svg');
    assert.equal(await standalone.locator('#open-pdf').isDisabled(), true);
    assert.equal(await standalone.locator('#print').isEnabled(), true, 'Standalone files retain browser printing');
    await standalone.close();
    assert.deepEqual(errors, [], 'No JavaScript errors');
    console.log(`All browser checks passed. Screenshots and PDFs from Open PDF and printing: ${output}`);
  } finally { await browser.close(); helper.kill(); ready.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
