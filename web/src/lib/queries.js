import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';

export const useTypes = () => useQuery({ queryKey: ['types'], queryFn: () => api('/types'), staleTime: Infinity });
export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: () => api('/tags') });
export const useItems = (queryString) =>
  useQuery({ queryKey: ['items', queryString], queryFn: () => api(`/items?${queryString}`), placeholderData: keepPreviousData });
export const useItem = (id) => useQuery({ queryKey: ['item', id], queryFn: () => api(`/items/${id}`), enabled: id != null });
export const useVersions = (id) => useQuery({ queryKey: ['versions', id], queryFn: () => api(`/items/${id}/versions`), enabled: id != null });

export function useRefresh() {
  const client = useQueryClient();
  return (id) => {
    client.invalidateQueries({ queryKey: ['items'] });
    client.invalidateQueries({ queryKey: ['tags'] });
    if (id != null) {
      client.invalidateQueries({ queryKey: ['item', id] });
      client.invalidateQueries({ queryKey: ['versions', id] });
    }
  };
}
