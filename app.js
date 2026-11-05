(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('settings');
  const glyphs = window.BlockGlyphs;
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const defaults = { style: 'block', scriptFont: 'allura', exercise: 'letters', content: 'A a\nB b', student: '', size: 8, trace: 2, blank: 2, paper: 'letter', guideColor: 'blue', repeat: true, guides: true, slant: 55 };
  const scriptFonts = {
    allura: { family: 'PracticeScript' },
    italianno: { family: 'PracticeItalianno' },
    sacramento: { family: 'PracticeSacramento' },
    parisienne: { family: 'PracticeParisienne' },
    dancing: { family: 'PracticeDancing' },
    greatvibes: { family: 'PracticeGreatVibes' },
    pinyon: { family: 'PracticePinyon' }
  };
  const presets = {
    letters: ['A a\nB b', 'Letters to practice', 'One letter, pair, or phrase per line.'],
    name: ['', 'Name to practice', 'Type your child’s name. It will repeat on each tracing line.'],
    words: ['hello\nkind\nsmile', 'Words & phrases', 'One word or phrase per line. Long phrases wrap into smaller exercises.'],
    numbers: ['1\n2\n3\n4\n5\n6\n7\n8\n9\n0', 'Numbers to practice', 'One number or group of numbers per line.'],
    strokes: ['', '', ''], blank: ['', '', '']
  };
  const ctx = document.createElement('canvas').getContext('2d');
  let pages = [], currentPage = 0, activeExercise = 'letters', timer, currentOptions, openingPdf = false;
  let nativeToken = null;
  if (location.protocol === 'http:' && location.hostname === '127.0.0.1') {
    try {
      nativeToken = new URLSearchParams(location.hash.slice(1)).get('token') || sessionStorage.getItem('little-letters-native-token');
      if (nativeToken) {
        sessionStorage.setItem('little-letters-native-token', nativeToken);
        history.replaceState(null, '', location.pathname + location.search);
      }
    } catch {}
  }
  const drafts = {};
  const escapeXML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const f = number => Number(number.toFixed(3));
  const read = () => {
    return Object.fromEntries(Object.keys(defaults).map(key => {
      const input = form.elements.namedItem(key);
      if (typeof defaults[key] === 'boolean') return [key, input.checked];
      if (typeof defaults[key] === 'number') return [key, Number(input.value)];
      return [key, String(input.value ?? '')];
    }));
  };
  function apply(options) {
    for (const [key, value] of Object.entries(options)) {
      const input = form.elements.namedItem(key);
      if (!input) continue;
      if (typeof value === 'boolean') input.checked = value;
      else input.value = value;
    }
    activeExercise = options.exercise;
    updateFields();
  }
  function updateFields() {
    const o = read();
    $('size-output').textContent = `${o.size} mm`;
    $('content-fields').hidden = ['blank', 'strokes'].includes(o.exercise);
    $('quick-actions').hidden = o.exercise !== 'letters';
    $('content-label').textContent = presets[o.exercise][1];
    $('content-note').textContent = presets[o.exercise][2];
    $('content').placeholder = o.exercise === 'name' ? 'Type a name to practice' : 'Type something to practice';
    $('slant-field').hidden = o.style !== 'script';
    $('script-font-field').hidden = o.style !== 'script';
    document.querySelector('.script-sample').style.fontFamily = scriptFonts[o.scriptFont].family;
    $('style-note').textContent = o.style === 'block'
      ? 'Single-line letters with dots to follow.'
      : 'Flowing letters with dotted outlines to trace.';
    $('trace').disabled = o.exercise === 'blank';
    $('repeat').disabled = ['blank', 'strokes'].includes(o.exercise);
    $('blank').disabled = o.exercise === 'blank';
    $('paper-label').textContent = o.paper === 'a4' ? 'A4' : 'US Letter';
  }
  function fontSize(o, family = scriptFonts[o.scriptFont].family) {
    ctx.font = `100px ${family}`;
    const cap = ctx.measureText('H').actualBoundingBoxAscent || 70;
    return o.size * 100 / cap;
  }
  function widthOf(text, o) {
    if (o.style === 'script') {
      ctx.font = `${fontSize(o)}px ${scriptFonts[o.scriptFont].family}`;
      return ctx.measureText(text).width;
    }
    let width = 0;
    for (const char of Array.from(text)) {
      if (glyphs[char]) width += (glyphs[char][0] + 1.5) * o.size / 10;
      else {
        ctx.font = `${fontSize(o, 'PracticeBlock')}px PracticeBlock`;
        width += ctx.measureText(char).width + o.size * .15;
      }
    }
    return Math.max(0, width - o.size * .15);
  }
  function wrap(text, maxWidth, o) {
    // Split at word boundaries where possible, and by code point for a long word.
    const pieces = [];
    let rest = text;
    while (rest && widthOf(rest, o) > maxWidth) {
      const chars = Array.from(rest);
      let count = 1;
      while (count < chars.length && widthOf(chars.slice(0, count + 1).join(''), o) <= maxWidth) count++;
      const candidate = chars.slice(0, count).join('');
      const space = candidate.lastIndexOf(' ');
      const cut = space > 0 ? Array.from(candidate.slice(0, space)).length : count;
      pieces.push(chars.slice(0, cut).join('').trim());
      rest = chars.slice(cut).join('').trim();
    }
    if (rest) pieces.push(rest);
    return pieces;
  }
  function lettering(text, x, baseline, o, dotted = false) {
    if (o.style === 'script') {
      const ink = dotted ? '#8a8d91' : '#3c4543';
      return `<text x="${f(x)}" y="${f(baseline)}" font-family="${scriptFonts[o.scriptFont].family}" font-size="${f(fontSize(o))}" ${dotted ? `fill="none" stroke="${ink}" stroke-width=".24" stroke-dasharray=".01 .8" stroke-linecap="round" stroke-linejoin="round"` : `fill="${ink}"`}>${escapeXML(text)}</text>`;
    }
    let result = '', offset = x;
    const scale = o.size / 10;
    for (const char of Array.from(text)) {
      const glyph = glyphs[char];
      if (glyph) {
        if (glyph[1]) result += `<path d="${glyph[1]}" transform="translate(${f(offset)} ${f(baseline)}) scale(${f(scale)})" fill="none" stroke="${dotted ? '#858b8f' : '#3c4543'}" stroke-width="${dotted ? '.6' : '.55'}" stroke-linecap="round" stroke-linejoin="round" ${dotted ? 'stroke-dasharray=".01 1.6"' : ''}/>`;
        offset += (glyph[0] + 1.5) * scale;
      } else {
        const size = fontSize(o, 'PracticeBlock');
        result += `<text x="${f(offset)}" y="${f(baseline)}" font-family="PracticeBlock" font-size="${f(size)}" ${dotted ? 'fill="none" stroke="#858b8f" stroke-width=".24" stroke-dasharray=".01 .8" stroke-linecap="round"' : 'fill="#3c4543"'}>${escapeXML(char)}</text>`;
        ctx.font = `${size}px PracticeBlock`;
        offset += ctx.measureText(char).width + scale * 1.5;
      }
    }
    return result;
  }
  function guideLines(x, y, width, o) {
    if (!o.guides) return '';
    const color = o.guideColor === 'blue' ? '#c0d4e1' : '#c9cbca';
    const baseColor = o.guideColor === 'blue' ? '#93b3ca' : '#9da3a0';
    let svg = '';
    for (const [offset, dash, stroke, lineColor] of [[-o.size, '', .22, color], [-o.size * .6, '1 1', .2, color], [0, '', .28, baseColor], [o.size * .3, '', .18, color]]) {
      svg += `<path d="M${x} ${f(y + offset)} h${f(width)}" fill="none" stroke="${lineColor}" stroke-width="${stroke}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
    }
    if (o.style === 'script' && o.slant > 0) {
      const height = o.size * 1.3, dx = height / Math.tan(o.slant * Math.PI / 180);
      for (let at = x; at + dx <= x + width; at += o.size * 1.7) {
        svg += `<path d="M${f(at)} ${f(y + o.size * .3)} l${f(dx)} ${f(-height)}" stroke="${color}" stroke-width=".15" fill="none"/>`;
      }
    }
    return svg;
  }
  const warmups = [
    { title: 'Tall lines', path: 'M2 -10 V0', advance: 8 },
    { title: 'Round shapes', path: 'M5 -8 C0 -8 0 0 5 0 C10 0 10 -8 5 -8 Z', advance: 13 },
    { title: 'Over the hills', path: 'M1 0 V-4 C1 -10 7 -10 7 -4 V0', advance: 11 },
    { title: 'Under the bridges', path: 'M1 -8 V-4 C1 2 7 2 7 -4 V-8', advance: 11 },
    { title: 'Loopy loops', path: 'M0 0 C3 -3 8 -8 5 -10 C0 -13 -1 0 8 0', advance: 11 }
  ];
  function warmupRow(unit, x, baseline, width, o, dotted) {
    let result = '';
    const scale = o.size / 10;
    for (let at = x; at + unit.advance * scale <= x + width; at += unit.advance * scale) {
      result += `<path d="${unit.path}" transform="translate(${f(at)} ${f(baseline)}) scale(${f(scale)})" fill="none" stroke="${dotted ? '#858b8f' : '#3c4543'}" stroke-width=".55" stroke-linecap="round" stroke-linejoin="round" ${dotted ? 'stroke-dasharray=".01 1.6"' : ''}/>`;
    }
    return result;
  }
  function build(o) {
    const width = o.paper === 'a4' ? 210 : 215.9;
    const height = o.paper === 'a4' ? 297 : 279.4;
    const left = 16, writingWidth = width - left - 16;
    const rowHeight = o.size * 1.8 + 4;
    const bottom = height - 19;
    const maxLinesPerRow = Math.max(1, Math.floor((bottom - 53) / rowHeight));
    const renderRow = (unit, kind, top) => {
      const lines = unit?.lines || [unit?.text || ''];
      const lineCount = lines.length;
      let row = '';
      for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
        const baseline = top + o.size + 2 + lineIndex * rowHeight;
        row += guideLines(left, baseline, writingWidth, o);
        if (kind === 'blank') continue;
        if (unit.path) row += warmupRow(unit, left + 1, baseline, writingWidth - 2, o, kind === 'trace');
        else {
          const text = lines[lineIndex];
          const textWidth = widthOf(text, o), gap = Math.max(o.size * .9, 6);
          // Tile single-line exercises; keep wrapped sentence fragments together once per trace.
          const count = kind === 'trace' && o.repeat && lines.length === 1 ? Math.max(1, Math.floor((writingWidth - 2 + gap) / (textWidth + gap))) : 1;
          for (let i = 0; i < count; i++) row += lettering(text, left + 1 + i * (textWidth + gap), baseline, o, kind === 'trace');
        }
      }
      return `<g class="practice-row row-${kind}">${row}</g>`;
    };
    let units = [];
    if (o.exercise === 'strokes') units = warmups;
    else if (o.exercise === 'blank') units = [{ title: 'A little space to write', text: '' }];
    else {
      for (const line of o.content.split(/\r?\n/).map(s => s.trim().normalize('NFC')).filter(Boolean)) {
        const parts = wrap(line, writingWidth - 3, o);
        for (let start = 0; start < parts.length; start += maxLinesPerRow) {
          const lines = parts.slice(start, start + maxLinesPerRow);
          units.push({ title: `${lines[0]}${lines.length > 1 || start > 0 ? ' …' : ''}`, lines });
        }
      }
    }
    if (!units.length) return { pages: [], note: '', width, height };
    // Keep previews and print jobs bounded, including pasted multiline text.
    const limit = 100;
    let truncated = false;
    const result = [];
    let fragments = [], y = 46, lastRowBottom = 46, fillerLineCount = 1;
    const flush = () => {
      if (fragments.length) {
        // Fill only complete writing groups so a wrapped sentence is never cut short.
        const fillerHeight = fillerLineCount * rowHeight;
        const filler = { lines: Array(fillerLineCount).fill('') };
        while (lastRowBottom + fillerHeight <= bottom) {
          fragments.push(renderRow(filler, 'blank', lastRowBottom));
          lastRowBottom += fillerHeight;
        }
        result.push(fragments.join(''));
      }
      fragments = [];
      y = lastRowBottom = 46;
      fillerLineCount = 1;
    };
    outer: for (const unit of units) {
      const linesPerGroup = unit.lines?.length || 1;
      const blankGroups = Math.ceil(o.blank / linesPerGroup);
      const rows = o.exercise === 'blank' ? Array.from({ length: Math.floor((bottom - 52) / rowHeight) }, () => 'blank') : ['model', ...Array(o.trace).fill('trace'), ...Array(blankGroups).fill('blank')];
      let index = 0;
      while (index < rows.length) {
        const rowSpan = (unit.lines?.length || 1) * rowHeight;
        if (y + 7 + rowSpan > bottom) flush();
        if (result.length >= limit) { truncated = true; break outer; }
        const title = o.exercise === 'blank' ? unit.title : `${unit.title}${index ? ' · continued' : ''}`;
        fragments.push(`<text x="16" y="${f(y)}" fill="#777f79" font-family="PracticeBlock" font-size="2.7">${escapeXML(title)}</text>`);
        y += 5;
        while (index < rows.length) {
          const currentSpan = (unit.lines?.length || 1) * rowHeight;
          if (y + currentSpan > bottom) break;
          fragments.push(renderRow(unit, rows[index], y));
          y += currentSpan;
          lastRowBottom = y;
          fillerLineCount = unit.lines?.length || 1;
          index++;
        }
        if (index < rows.length) flush();
      }
      y += 8;
    }
    flush();
    const titles = { letters: 'My letter practice', name: 'My name practice', words: 'My word practice', numbers: 'My number practice', strokes: 'My pen warm-ups', blank: 'My writing practice' };
    const svgs = result.map((body, i) => {
      let name = o.student.trim();
      ctx.font = '3px PracticeBlock';
      const maxNameWidth = width - 99;
      while (name && ctx.measureText(name).width > maxNameWidth) name = Array.from(name).slice(0, -1).join('');
      if (name !== o.student.trim()) name = name.slice(0, -1) + '…';
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXML(titles[o.exercise])}, page ${i + 1} of ${result.length}"><title>${escapeXML(titles[o.exercise])} · ${i + 1}/${result.length}</title><rect width="${width}" height="${height}" fill="white"/><text x="16" y="15" font-family="PracticeBlock" font-size="2.3" fill="#919887" letter-spacing=".5">LITTLE LETTERS</text><text x="16" y="25" font-family="PracticeBlock" font-size="6" fill="#394b3d">${titles[o.exercise]}</text><text x="16" y="35" font-family="PracticeBlock" font-size="2.6" fill="#7c847c">Name:</text>${name ? `<text x="27" y="35" font-family="PracticeBlock" font-size="3" fill="#465444">${escapeXML(name)}</text>` : `<path d="M27 36 H${f(width - 70)}" stroke="#c9cec5" stroke-width=".2"/>`}<text x="${f(width - 60)}" y="35" font-family="PracticeBlock" font-size="2.6" fill="#7c847c">Date:</text><path d="M${f(width - 50)} 36 H${f(width - 16)}" stroke="#c9cec5" stroke-width=".2"/>${body}<text x="16" y="${f(height - 10)}" font-family="PracticeBlock" font-size="2.3" fill="#8e9689">${o.style === 'script' ? 'Take it slowly. Let your letters flow.' : 'Every little letter is a step forward.'}</text><text x="${f(width - 16)}" y="${f(height - 10)}" text-anchor="end" font-family="PracticeBlock" font-size="2.3" fill="#8e9689">${i + 1} / ${result.length}</text></svg>`;
    });
    const note = truncated ? 'This worksheet is limited to 100 pages. Shorten the text to include all exercises.' : '';
    return { pages: svgs, note, width, height };
  }
  function showPage() {
    $('sheet').innerHTML = pages[currentPage] || '<div class="sheet-empty"><strong>What shall we practice?</strong>Type a name, some letters, or a favorite word to make your worksheet.</div>';
    $('page-count').textContent = pages.length ? `Page ${currentPage + 1} of ${pages.length}` : 'No pages yet';
    $('previous').disabled = currentPage === 0 || !pages.length;
    $('next').disabled = currentPage >= pages.length - 1;
    $('open-pdf').disabled = !pages.length || openingPdf || !nativeToken;
    $('open-pdf').title = nativeToken ? 'Create a PDF and open it in your document viewer' : 'Open Little Letters from its Omarchy icon or launcher for native PDF export; Print / save PDF also works here';
    $('print').disabled = !pages.length;
  }
  function generate(resetPage = false) {
    clearTimeout(timer);
    updateFields();
    currentOptions = read();
    const result = build(currentOptions);
    pages = result.pages;
    currentPage = resetPage ? 0 : Math.min(currentPage, Math.max(0, pages.length - 1));
    $('feedback').textContent = result.note;
    const style = $('print-page-style') || Object.assign(document.createElement('style'), { id: 'print-page-style' });
    style.textContent = `@page{size:${result.width}mm ${result.height}mm;margin:0}@media print{.print-page{width:${result.width}mm;height:${result.height}mm}}`;
    if (!style.parentNode) document.head.appendChild(style);
    showPage();
    // Preferences stay on this device. File URLs and private modes may disallow storage.
    try { localStorage.setItem('little-letters-v1', JSON.stringify(currentOptions)); } catch {}
  }
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', event => {
    if (event.target === $('exercise')) return;
    updateFields();
    clearTimeout(timer);
    timer = setTimeout(() => generate(), event.target === $('content') || event.target === $('student') ? 180 : 30);
  });
  $('exercise').addEventListener('change', () => {
    drafts[activeExercise] = $('content').value;
    activeExercise = $('exercise').value;
    $('content').value = drafts[activeExercise] ?? presets[activeExercise][0];
    generate(true);
  });
  document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
    const chars = button.dataset.preset === 'first' ? alphabet.slice(0, 6) : alphabet;
    $('content').value = Array.from(chars, c => button.dataset.preset === 'lower' ? c : button.dataset.preset === 'upper' ? c.toUpperCase() : `${c.toUpperCase()} ${c}`).join('\n');
    generate(true);
  }));
  $('reset').addEventListener('click', () => {
    for (const key of Object.keys(drafts)) delete drafts[key];
    apply(defaults);
    generate(true);
  });
  $('previous').addEventListener('click', () => { currentPage--; showPage(); });
  $('next').addEventListener('click', () => { currentPage++; showPage(); });
  $('open-pdf').addEventListener('click', async () => {
    generate();
    if (!pages.length || !nativeToken) return;
    const button = $('open-pdf');
    openingPdf = button.disabled = true;
    button.textContent = 'Preparing PDF…';
    try {
      const response = await fetch('/api/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${nativeToken}` },
        body: JSON.stringify({ paper: currentOptions.paper, pages: [...pages] })
      });
      if (!response.ok) throw new Error('Native PDF export failed');
      $('feedback').textContent = 'PDF opened in your document viewer.';
    } catch (error) {
      $('feedback').textContent = 'The PDF could not be opened. Please try again or use Print / save PDF.';
    } finally {
      openingPdf = false;
      button.textContent = '↗ Open PDF';
      button.disabled = !pages.length;
    }
  });
  if (nativeToken) {
    const ping = () => fetch('/api/ping', { headers: { 'Authorization': `Bearer ${nativeToken}` } }).catch(() => {});
    ping();
    setInterval(ping, 30000);
  }
  function preparePrint() {
    generate();
    $('print-sheets').innerHTML = pages.map(svg => `<div class="print-page">${svg}</div>`).join('');
  }
  window.addEventListener('beforeprint', preparePrint);
  window.addEventListener('afterprint', () => { $('print-sheets').replaceChildren(); });
  $('print').addEventListener('click', () => { preparePrint(); if (pages.length) window.print(); });
  let saved = {};
  try {
    const stored = JSON.parse(localStorage.getItem('little-letters-v1'));
    // Validate persisted values before using them as dimensions, counts, or option keys.
    if (stored && typeof stored === 'object') {
      for (const [key, fallback] of Object.entries(defaults)) {
        if (typeof stored[key] !== typeof fallback) continue;
        if (typeof fallback === 'boolean') saved[key] = stored[key];
        else if (['content', 'student'].includes(key)) saved[key] = stored[key].slice(0, key === 'content' ? 2000 : 60);
        else if (key === 'style' && ['block', 'script'].includes(stored[key])) saved[key] = stored[key];
        else if (key === 'size' && Number.isInteger(stored[key]) && stored[key] >= 5 && stored[key] <= 16) saved[key] = stored[key];
        else if (['trace', 'blank'].includes(key) && [1, 2, 3, 4].includes(stored[key])) saved[key] = stored[key];
        else if (key === 'slant' && [0, 55, 65, 75].includes(stored[key])) saved[key] = stored[key];
        else {
          const input = form.elements.namedItem(key);
          if (input instanceof HTMLSelectElement && Array.from(input.options).some(opt => opt.value === stored[key])) saved[key] = stored[key];
        }
      }
    }
  } catch {}
  apply({ ...defaults, ...saved });
  // Font loading is awaited so measured text fits the preview and exported worksheet.
  Promise.all(['PracticeBlock', ...Object.values(scriptFonts).map(font => font.family)].map(family => document.fonts.load(`20px ${family}`))).then(() => generate());
})();
