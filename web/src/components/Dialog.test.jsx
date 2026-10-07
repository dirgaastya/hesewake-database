import { afterEach, expect, test } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Dialog } from './Dialog.jsx';

afterEach(cleanup);

function Harness() {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        buka
      </button>
      {/* onClose inline: berubah tiap render, sama seperti pemakaian sungguhan */}
      <Dialog open={open} onClose={() => setOpen(false)} title="Uji">
        <input aria-label="password" value={value} onChange={(e) => setValue(e.target.value)} />
      </Dialog>
    </>
  );
}

const tick = (ms = 10) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

test('fokus tidak lompat keluar dialog saat mengetik (regresi: hanya karakter pertama yang masuk)', async () => {
  render(<Harness />);
  const opener = screen.getByText('buka');
  opener.focus();
  fireEvent.click(opener);
  await tick();
  const input = screen.getByLabelText('password');
  expect(document.activeElement).toBe(input);
  for (const value of ['a', 'ab', 'abc', 'abcd']) {
    fireEvent.change(input, { target: { value } });
    // Dicek langsung, sebelum timer fokus sempat jalan: ketikan berikutnya harus tetap masuk ke input.
    expect(document.activeElement).toBe(input);
  }
  expect(input.value).toBe('abcd');
});

test('Escape menutup dialog lewat onClose terbaru dan fokus kembali ke pemicu', async () => {
  render(<Harness />);
  const opener = screen.getByText('buka');
  opener.focus();
  fireEvent.click(opener);
  await tick();
  fireEvent.keyDown(document, { key: 'Escape' });
  await tick(300);
  expect(screen.queryByLabelText('password')).toBeNull();
  expect(document.activeElement).toBe(opener);
});
