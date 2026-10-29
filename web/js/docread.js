// Gets the text out of an uploaded copy: a PDF's own text layer when it has one,
// otherwise OCR (Tesseract.js, loaded on first use) of the photo or the PDF's first page.
import { pdfjs, pdfToImages } from './iddocs.js';
import { extractDocInfo } from './docinfo.js';

let tessPromise = null;
function tesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tessPromise) {
    tessPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload = () => res(window.Tesseract);
      s.onerror = () => { tessPromise = null; rej(new Error('Text reader did not load — check your internet connection.')); };
      document.head.appendChild(s);
    });
  }
  return tessPromise;
}
let workerPromise = null;
async function worker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const T = await tesseract();
      return T.createWorker('eng');
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

/** Grey, enlarged copy of an image so small print reads better. */
function prepImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(2.5, Math.max(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight)));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      const x = c.getContext('2d');
      x.filter = 'grayscale(1) contrast(1.25)';
      x.drawImage(img, 0, 0, c.width, c.height);
      res(c);
    };
    img.onerror = () => rej(new Error('Could not read this image.'));
    img.src = src;
  });
}

async function ocr(src) {
  const w = await worker();
  const { data } = await w.recognize(await prepImage(src));
  return data.text || '';
}

async function pdfText(b64) {
  const lib = await pdfjs();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const pdf = await lib.getDocument({ data: bytes }).promise;
  let out = '';
  for (let i = 1; i <= Math.min(2, pdf.numPages); i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    // keep line breaks: a new line whenever the y position changes
    let lastY = null;
    for (const it of tc.items) {
      const y = it.transform ? Math.round(it.transform[5]) : null;
      out += (lastY != null && y !== lastY ? '\n' : ' ') + it.str;
      lastY = y;
    }
    out += '\n';
  }
  return out;
}

/** Text of one copy ({ mime, base64 }). */
export async function docText({ mime, base64 }) {
  if (mime === 'application/pdf') {
    const t = await pdfText(base64).catch(() => '');
    if (t.replace(/\s/g, '').length > 40) return t;
    const imgs = await pdfToImages(base64, 1);
    return imgs.length ? ocr(imgs[0]) : '';
  }
  return ocr(`data:${mime};base64,${base64}`);
}

/** { number, expiry, issue } read from one copy. Never throws — returns empty fields on failure. */
export async function readDocInfo(file, kind) {
  try {
    return extractDocInfo(await docText(file), kind);
  } catch (e) {
    console.warn('read document', e);
    return { number: '', expiry: '', issue: '' };
  }
}
