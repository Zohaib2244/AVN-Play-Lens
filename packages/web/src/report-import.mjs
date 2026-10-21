// Positioned PDF/OCR words preserve the two columns, including page continuations.
export function parseReportWords(pages) {
  const rows = [];
  const identity = { packageId: '', versionName: '', versionCode: '' };
  let inDev = false;
  let section = '';
  for (const [index, words] of pages.entries()) {
    const lines = [];
    const centered = words.map((w) => ({ ...w, y: w.y + (w.h || 0) / 2 }));
    for (const w of centered.sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (!w.text.trim()) continue;
      let line = lines.findLast((l) => Math.abs(l.y - w.y) < Math.max(0.004, (w.h || .01) * .5));
      if (!line) { line = { y: w.y, words: [] }; lines.push(line); }
      line.words.push(w);
    }
    for (const line of lines) {
      const ws = line.words.sort((a, b) => a.x - b.x);
      const all = ws.map((w) => w.text).join(' ').trim();
      const left = ws.filter((w) => w.x < .465).map((w) => w.text).join(' ').trim();
      const right = ws.filter((w) => w.x >= .465).map((w) => w.text).join(' ').trim();
      if (/^package name$/i.test(left)) identity.packageId = right.replace(/\s/g, '');
      if (/^version\s*\(bundle\s*version\)$/i.test(left)) identity.versionName = right.replace(/\s/g, '');
      if (/^bundle version code$/i.test(left)) identity.versionCode = right.replace(/\s/g, '');
      if (/^FOR DEV\b/i.test(all)) { inDev = true; continue; }
      if (!inDev) continue;
      if (/^FOR (?:MARKETING|QA)\b/i.test(all)) { inDev = false; continue; }
      if (/^\d+[.)]\s+[A-Z]/.test(all)) { section = all; continue; }
      if (!section || /installed adapters|publishing checklist|^page \d/i.test(all) || /^[-—\s]+$/.test(all)) continue;
      const prev = rows.at(-1);
      if (left && right) rows.push({ section, label: left, value: right, page: index + 1 });
      else if (prev && prev.section === section && right) prev.value += ` ${right}`;
      else if (prev && prev.section === section && left && line.y < .97) prev.label += ` ${left}`;
    }
  }
  return { ...identity, rows };
}

export function tsvWords(tsv, width, height) {
  return (tsv || '').split('\n').slice(1).flatMap((line) => {
    const c = line.split('\t');
    if (c[0] !== '5' || !c[11]?.trim()) return [];
    return [{ text: c.slice(11).join('\t'), x: Number(c[6]) / width, y: Number(c[7]) / height, h: Number(c[9]) / height }];
  });
}

export async function readPublishingPdf(file, progress = () => {}) {
  if (!file || file.size > 20 * 1024 * 1024) throw new Error('Choose a publishing PDF under 20 MB.');
  const [{ getDocument, GlobalWorkerOptions }, workerUrl] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  GlobalWorkerOptions.workerSrc = workerUrl.default;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({ data: bytes });
  const doc = await task.promise;
  let worker;
  let currentPage = 0;
  let ocr = false;
  const pages = [];
  try {
    if (doc.numPages > 30) throw new Error('Publishing reports must have 30 pages or fewer.');
    for (let n = 1; n <= doc.numPages; n++) {
      currentPage = n;
      progress(`Reading page ${n} of ${doc.numPages}`);
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const text = await page.getTextContent();
      let words = text.items.filter((i) => i.str?.trim()).map((i) => ({ text: i.str, x: i.transform[4] / viewport.width, y: (viewport.height - i.transform[5] - i.height) / viewport.height, h: i.height / viewport.height }));
      if (words.length < 10) {
        ocr = true;
        progress(`Reading image page ${n} of ${doc.numPages} with OCR…`);
        if (!worker) {
          const { createWorker } = await import('tesseract.js');
          worker = await createWorker('eng', 1, { workerPath: '/ocr/worker.min.js', corePath: '/ocr', langPath: '/ocr', workerBlobURL: false, logger: (m) => progress(`OCR page ${currentPage} of ${doc.numPages}: ${m.status}${m.progress != null ? ` ${Math.round(m.progress * 100)}%` : ''}`) });
          await worker.setParameters({ tessedit_pageseg_mode: '6' });
        }
        const canvas = document.createElement('canvas');
        const scale = Math.min(3, 1800 / viewport.width);
        const vp = page.getViewport({ scale });
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        const { data } = await worker.recognize(canvas, {}, { tsv: true });
        words = tsvWords(data.tsv, canvas.width, canvas.height);
        canvas.width = canvas.height = 0;
      }
      pages.push(words);
      page.cleanup();
    }
    const parsed = parseReportWords(pages);
    if (!parsed.rows.length) throw new Error('No For Dev table found. Upload the plugin’s publishing checklist PDF.');
    const pdf = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
    return { ...parsed, ocr, filename: file.name, pdf };
  } finally {
    await worker?.terminate();
    await task.destroy();
  }
}
