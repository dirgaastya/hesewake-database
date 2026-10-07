import { readFileSync } from 'node:fs';
import { openContext } from './context.js';

// Jalankan OCR untuk gambar yang diunggah sebelum OCR aktif (atau yang gagal sebelumnya).
const { repo, storage, ocr, config } = openContext();
if (!ocr) {
  console.log('OCR dimatikan (HDB_OCR=0).');
  process.exit(0);
}

const images = repo.imagesWithoutText();
console.log(images.length ? `OCR ${images.length} gambar (data bahasa diunduh ke ${config.ocrCacheDir} saat pertama kali)` : 'Semua gambar sudah punya teks.');
let found = 0;
for (const item of images) {
  try {
    const text = await ocr.recognize(readFileSync(storage.absolutePath(item.file.path)));
    if (text) {
      repo.setExtractedText(item.id, text);
      found++;
    }
    console.log(`  ${text ? 'teks   ' : 'kosong '} #${String(item.id).padStart(4, '0')} ${item.title}`);
  } catch (err) {
    console.log(`  gagal  #${String(item.id).padStart(4, '0')} ${item.title}: ${err.message}`);
  }
}
if (images.length) console.log(`Selesai: ${found} gambar sekarang bisa dicari isinya.`);
await ocr.terminate();
