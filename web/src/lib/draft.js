// Isi awal untuk form "Item baru" yang datang dari QuickCapture atau command palette. Hanya di memori.
let pending = null;

export function setPendingDraft(draft) {
  pending = draft;
}

export function takePendingDraft() {
  const draft = pending;
  pending = null;
  return draft;
}
