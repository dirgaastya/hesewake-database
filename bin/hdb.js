#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { openContext } from '../src/cli/context.js';
import { createTicketService, loadHesewakeCli } from '../src/integrations/odoo.js';
import { runHdb } from '../src/cli/hdb/commands.js';

function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(output) : reject(new Error(`${command} keluar dengan kode ${code}`))));
    child.stdin.end(input ?? '');
  });
}

const clipboard = {
  win32: {
    copy: (text) => run('powershell.exe', ['-NoProfile', '-Command', '$t = [Console]::In.ReadToEnd(); if ($t) { Set-Clipboard -Value $t } else { Set-Clipboard -Value $null }'], text),
    read: async () => (await run('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Raw'])).replace(/\r?\n$/, ''),
  },
  darwin: { copy: (text) => run('pbcopy', [], text), read: () => run('pbpaste', []) },
  linux: { copy: (text) => run('xclip', ['-selection', 'clipboard'], text), read: () => run('xclip', ['-selection', 'clipboard', '-o']) },
}[process.platform] ?? { copy: async () => { throw new Error('Clipboard tidak didukung di OS ini'); }, read: async () => '' };

function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Jangan tampilkan karakter yang diketik.
      rl._writeToOutput = (text) => {
        if (text.includes(question)) process.stdout.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data.replace(/\r?\n$/, '');
}

const io = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  prompt: (question) => prompt(question),
  promptSecret: (question) => prompt(question, { hidden: true }),
  readStdin,
  copy: (text) => clipboard.copy(text),
  readClipboard: () => clipboard.read(),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  openUrl: (url) => run(process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open', process.platform === 'win32' ? ['/c', 'start', '', url] : [url]),
};

const argv = process.argv.slice(2);
const ctx = openContext();
let tickets;
if (argv[0] === 'ticket') {
  const odoo = await loadHesewakeCli(ctx.config.hesewakeCliDir).catch(() => ({ loader: null, odooUrl: null }));
  const service = createTicketService(odoo);
  tickets = service.available ? service : undefined;
}

const code = await runHdb(argv, { ctx, io, tickets });
ctx.db.close();
process.exit(code);
