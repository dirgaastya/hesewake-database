import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';

export const useCollections = () =>
  useQuery({
    queryKey: ['collections'],
    queryFn: () => api('/collections'),
  });
