import { openContext } from './context.js';
import { createBackup } from '../backup/backup.js';

const { config, db } = openContext();
const result = createBackup({ db, filesDir: config.filesDir, backupDir: config.backupDir, keep: config.backupKeep });
console.log(`Backup: ${result.dbFile} (+${result.copiedFiles} file baru, ${result.removed.length} salinan lama dihapus)`);
