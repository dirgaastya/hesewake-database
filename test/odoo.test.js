import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTicketService, TicketUnavailableError } from '../src/integrations/odoo.js';
import { NotFoundError } from '../src/errors.js';

const TASK = {
  id: 8193,
  name: 'Hotfix tarif kamar VIP',
  stage_id: [255, 'IN PROGRESS BUG / HOTFIX'],
  project_id: [2, 'Medicare'],
  date_deadline: '2026-10-09',
};

test('get: bentuk ringkas + URL Odoo', async () => {
  const calls = [];
  const tickets = createTicketService({
    loader: async (id) => {
      calls.push(id);
      return TASK;
    },
    odooUrl: 'https://ticket.alfatih-solusindo.com/',
  });
  assert.deepEqual(await tickets.get(8193), {
    id: 8193,
    name: 'Hotfix tarif kamar VIP',
    stage: 'IN PROGRESS BUG / HOTFIX',
    project: 'Medicare',
    deadline: '2026-10-09',
    url: 'https://ticket.alfatih-solusindo.com/web#id=8193&model=project.task&view_type=form',
  });
  assert.equal(tickets.available, true);
});

test('get: cache per id selama TTL', async () => {
  let t = 0;
  let calls = 0;
  const tickets = createTicketService({ loader: async () => (calls++, TASK), odooUrl: 'https://x', ttlMs: 1000, now: () => t });
  await tickets.get(8193);
  await tickets.get(8193);
  assert.equal(calls, 1);
  t = 1001;
  await tickets.get(8193);
  assert.equal(calls, 2);
});

test('get: task tidak ada → NotFoundError, field kosong aman', async () => {
  const tickets = createTicketService({ loader: async (id) => (id === 1 ? { id: 1, name: 'X', stage_id: false, project_id: false, date_deadline: false } : null), odooUrl: 'https://x' });
  await assert.rejects(tickets.get(2), NotFoundError);
  assert.deepEqual(await tickets.get(1), { id: 1, name: 'X', stage: null, project: null, deadline: null, url: 'https://x/web#id=1&model=project.task&view_type=form' });
});

test('tanpa loader atau loader gagal → TicketUnavailableError (503)', async () => {
  const none = createTicketService({ loader: null, odooUrl: null });
  assert.equal(none.available, false);
  await assert.rejects(none.get(1), (err) => err instanceof TicketUnavailableError && err.status === 503);

  const broken = createTicketService({ loader: async () => { throw new Error('ENOTFOUND ticket.alfatih-solusindo.com'); }, odooUrl: 'https://x' });
  await assert.rejects(broken.get(1), /Odoo tidak bisa dihubungi/);
});
