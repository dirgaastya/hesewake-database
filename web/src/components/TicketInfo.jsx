import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { api } from '../lib/api.js';
import { MetaLabel } from './ui.jsx';

// Ringkasan task Odoo dari hesewake-cli (GET /api/tickets/:id). Kalau integrasi belum diatur, tidak tampil apa-apa.
export function TicketInfo({ ticketId }) {
  const ticket = useQuery({ queryKey: ['ticket', ticketId], queryFn: () => api(`/tickets/${ticketId}`), staleTime: 5 * 60_000, retry: false });
  if (!ticket.data) return null;
  const { name, stage, project, url } = ticket.data;
  return (
    <section className="grid gap-2">
      <MetaLabel items={['Tiket Odoo', `#${ticketId}`, stage]} />
      <a href={url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-3 rounded-sm border border-line bg-surface px-3 py-2 text-fg no-underline hover:border-line-strong">
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-sm font-semibold">{name}</span>
          {project && <span className="truncate text-xs text-fg-subtle">{project}</span>}
        </span>
        <ExternalLink size={16} strokeWidth={1.5} className="shrink-0 text-fg-subtle" aria-hidden="true" />
      </a>
    </section>
  );
}
