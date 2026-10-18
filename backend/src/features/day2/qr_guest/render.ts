import QRCode from 'qrcode';
import { assemble, esc } from '../../store/pdf';

/** QR exports (spec 5.6): SVG, PNG and an uncompressed one-page A4 poster PDF, all encoding the stable short URL. */

const OPTS = { errorCorrectionLevel: 'M' as const, margin: 2 };

export async function qrSvg(shortUrl: string): Promise<string> {
  const svg = await QRCode.toString(shortUrl, { ...OPTS, type: 'svg' });
  // a <title> makes the encoded URL readable by screen readers and by a plain-text check
  return svg.replace(/^(<svg[^>]*>)/, `$1<title>${shortUrl.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>`);
}

export function qrPng(shortUrl: string): Promise<Buffer> {
  return QRCode.toBuffer(shortUrl, { ...OPTS, type: 'png', width: 512 });
}

/** A4 poster: title, the QR drawn as filled squares from the module matrix, entity id and short URL as real text. */
export function qrPdf(entityId: string, shortUrl: string, caption: string): Buffer {
  const { modules } = QRCode.create(shortUrl, { errorCorrectionLevel: 'M' });
  const size = modules.size;
  const cell = Math.floor(360 / size);
  const x0 = Math.round((595 - cell * size) / 2);
  const y0 = 690; // top edge of the code
  const rects: string[] = [];
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) if (modules.get(r, c)) rects.push(`${x0 + c * cell} ${y0 - (r + 1) * cell} ${cell} ${cell} re`);
  const text = (font: string, pt: number, y: number, s: string) => `BT\n/${font} ${pt} Tf\n1 0 0 1 56 ${y} Tm\n(${esc(s)}) Tj\nET\n`;
  const content =
    text('F2', 26, 770, "NaSCon '26 Live") +
    text('F1', 14, 742, caption) +
    `0 0 0 rg\n${rects.join('\n')}\nf\n` +
    text('F2', 16, y0 - cell * size - 40, entityId) +
    text('F1', 14, y0 - cell * size - 64, shortUrl) +
    text('F1', 11, y0 - cell * size - 88, 'Scan with your phone camera. No app or account needed.');
  return assemble(content);
}
