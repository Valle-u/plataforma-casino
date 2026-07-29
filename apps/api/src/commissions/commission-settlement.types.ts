export interface SettlementJobData {
  tenantSlug: string;
  params: {
    rowIds?: string[];
    periodStart?: string;
    reference?: string | null;
    actorUserId: string;
  };
}

export interface SettlementJobResult {
  settled: number;
  failed: number;
  totalPaid: string;
}
