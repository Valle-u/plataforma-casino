'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api-client';

export interface NetworkNode {
  id: string;
  username: string;
  displayName: string;
  status: string;
  isIndependentBranch: boolean;
  isSystem: boolean;
  parentUserId: string | null;
  relationType: string | null;
  roles: Array<{ code: string; name: string }>;
  primaryRole: string;
}

interface NetworkTreeResponse {
  nodes: NetworkNode[];
  total: number;
  /**
   * Si no es null, el árbol viene scopeado a la sub-red de este usuario
   * (operador no-admin): el mapa debe enraizar en él, no en "La Casa".
   */
  scopeRootId?: string | null;
}

export function useNetworkTree() {
  return useQuery({
    queryKey: ['network-tree'],
    queryFn: () => apiGet<NetworkTreeResponse>('/tenant/user-hierarchy/tree'),
    staleTime: 30_000,
  });
}
