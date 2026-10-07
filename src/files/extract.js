import { extname } from 'node:path';
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';

const MAX_CHARS = 200_000;
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.sql', '.csv', '.json', '.log', '.env', '.yml', '.yaml', '.xml', '.ini', '.conf', '.sh', '.js', '.php',
]);

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map((part) => part.text).join('');
    return String(value.text ?? value.result ?? '');
  }
  return String(value);
}

async function extractXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const lines = [];
  workbook.eachSheet((sheet) => {
    lines.push(sheet.name);
    sheet.eachRow((row) => {
      lines.push(row.values.map(cellText).filter(Boolean).join(' '));
    });
  });
  return lines.join('\n');
}

// Best-effort: gagal extract cuma berarti file tidak bisa dicari by isi, upload tetap jalan.
export async function extractText(buffer, { mime = '', name = '' } = {}) {
  const ext = extname(name).toLowerCase();
  try {
    let text = '';
    if (mime === 'application/pdf' || ext === '.pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      text = (await extractPdfText(pdf, { mergePages: true })).text;
    } else if (ext === '.docx') {
      text = (await mammoth.extractRawText({ buffer })).value;
    } else if (ext === '.xlsx') {
      text = await extractXlsx(buffer);
    } else if (mime.startsWith('text/') || TEXT_EXTENSIONS.has(ext)) {
      text = buffer.toString('utf8');
    }
    return text.slice(0, MAX_CHARS);
  } catch (err) {
    console.warn(`Gagal extract teks dari ${name}: ${err.message}`);
    return '';
  }
}
