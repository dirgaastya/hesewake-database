import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppError, NotFoundError } from '../errors.js';

const TASK_FIELDS = ['id', 'name', 'stage_id', 'project_id', 'date_deadline'];

export class TicketUnavailableError extends AppError {
  constructor(message = 'Integrasi Odoo belum diatur. Pastikan hesewake-cli terpasang dan sudah login.') {
    super(message, 503);
  }
}

const many2one = (value) => (Array.isArray(value) ? value[1] : null);

export function createTicketService({ loader, odooUrl, ttlMs = 5 * 60 * 1000, now = Date.now }) {
  const cache = new Map();
  const base = odooUrl ? odooUrl.replace(/\/+$/, '') : null;

  async function get(id) {
    if (!loader || !base) throw new TicketUnavailableError();
    const cached = cache.get(id);
    if (cached && cached.expires > now()) return cached.value;

    let task;
    try {
      task = await loader(id);
    } catch (err) {
      throw new TicketUnavailableError(`Odoo tidak bisa dihubungi: ${err.message}`);
    }
    if (!task) throw new NotFoundError(`Tiket #${id} tidak ditemukan di Odoo`);

    const value = {
      id: task.id,
      name: task.name,
      stage: many2one(task.stage_id),
      project: many2one(task.project_id),
      deadline: task.date_deadline || null,
      url: `${base}/web#id=${task.id}&model=project.task&view_type=form`,
    };
    cache.set(id, { value, expires: now() + ttlMs });
    return value;
  }

  return { get, available: Boolean(loader && base) };
}

// Pakai client Odoo milik hesewake-cli. Kredensial tetap dikelola hesewake-cli (Windows Credential Manager).
export async function loadHesewakeCli(dir) {
  const clientFile = join(dir, 'utils', 'odoo', 'client.js');
  const configFile = join(homedir(), '.hesewake-cli', 'config.json');
  if (!existsSync(clientFile) || !existsSync(configFile)) return { loader: null, odooUrl: null };
  const { odooUrl } = JSON.parse(readFileSync(configFile, 'utf8'));
  const { callOdoo } = await import(pathToFileURL(clientFile).href);
  const loader = async (id) => {
    const [task] = await callOdoo('project.task', 'search_read', [[['id', '=', id]], TASK_FIELDS], { context: { active_test: false } });
    return task ?? null;
  };
  return { loader, odooUrl };
}
