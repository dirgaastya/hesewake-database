import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';

export const useCollections = () => useQuery({ queryKey: ['collections'], queryFn: () => api('/collections') });
export const useItemCollections = (itemId) =>
  useQuery({ queryKey: ['item-collections', itemId], queryFn: () => api(`/items/${itemId}/collections`), enabled: itemId != null });

export function useCollectionActions() {
  const client = useQueryClient();
  const refresh = () => {
    client.invalidateQueries({ queryKey: ['collections'] });
    client.invalidateQueries({ queryKey: ['item-collections'] });
    client.invalidateQueries({ queryKey: ['items'] });
  };
  return {
    create: async (name) => {
      const created = await api('/collections', { method: 'POST', body: { name } });
      refresh();
      return created;
    },
    rename: async (id, name) => {
      await api(`/collections/${id}`, { method: 'PATCH', body: { name } });
      refresh();
    },
    remove: async (id) => {
      await api(`/collections/${id}`, { method: 'DELETE' });
      refresh();
    },
    add: async (id, itemId) => {
      await api(`/collections/${id}/items`, { method: 'POST', body: { itemId } });
      refresh();
    },
    detach: async (id, itemId) => {
      await api(`/collections/${id}/items/${itemId}`, { method: 'DELETE' });
      refresh();
    },
  };
}
