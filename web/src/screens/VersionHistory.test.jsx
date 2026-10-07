import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/theme.jsx';
import { ToastProvider } from '../components/Toast.jsx';
import { VaultProvider } from '../vault/VaultProvider.jsx';
import { UnlockProvider } from '../vault/UnlockDialog.jsx';
import { VersionHistory } from './VersionHistory.jsx';

const ITEM = {
  id: 1, type: 'query', title: 'Pasien aktif', content: 'SELECT a\nORDER BY a;', encrypted: false, metadata: { language: 'sql' },
  tags: ['simrs'], ticketId: null, pinned: false, archived: false, deletedAt: null, file: null, createdAt: '2026-10-07T10:00:00.000Z', updatedAt: '2026-10-07T12:00:00.000Z',
};
const VERSIONS = [{ id: 7, title: 'Pasien aktif', content: 'SELECT a', metadata: { language: 'sql' }, tags: ['simrs'], createdAt: '2026-10-07T11:00:00.000Z' }];

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const body = String(url).endsWith('/versions') ? VERSIONS : ITEM;
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('riwayat item biasa langsung menampilkan diff (regresi: halaman crash saat data versi datang)', async () => {
  const client = new QueryClient();
  render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <VaultProvider>
            <UnlockProvider>
              <VersionHistory itemId={1} onClose={() => {}} />
            </UnlockProvider>
          </VaultProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  await waitFor(() => expect(screen.getByText('Kembalikan versi ini')).toBeTruthy());
  expect(screen.getByText('Isi berubah')).toBeTruthy();
  expect(screen.getByText('ORDER BY a;')).toBeTruthy();
  expect(screen.queryByText(/Unlock vault untuk melihat/)).toBeNull();
});
