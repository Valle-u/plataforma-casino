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
}

export function useNetworkTree() {
  return useQuery({
    queryKey: ['network-tree'],
    queryFn: () => apiGet<NetworkTreeResponse>('/tenant/user-hierarchy/tree'),
    staleTime: 30_000,
  });
}
