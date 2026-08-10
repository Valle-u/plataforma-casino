/**
 * ScalarSection — sección genérica de settings escalares (lista de keys
 * conocidos con edición por drawer). Usada por Notificaciones, Antifraude,
 * Palace y Tesorería y comisiones.
 */

'use client';

import { useState } from 'react';
import { EditSettingDrawer } from '@/components/admin/edit-setting-drawer';
import { EmptyState } from '@/components/ui/empty-state';
import type {
  KnownSettingMeta,
  TenantSettingRow,
} from '@/lib/hooks/use-tenant-settings';
import { SectionCard, SettingRow } from './settings-common';

export function ScalarSection({
  title,
  description,
  metas,
  settingsByKey,
}: {
  title: string;
  description?: string;
  metas: KnownSettingMeta[];
  settingsByKey: Map<string, TenantSettingRow>;
}) {
  const [editKey, setEditKey] = useState<string | null>(null);

  return (
    <SectionCard title={title} description={description}>
      {metas.length === 0 ? (
        <EmptyState label="Sin settings en esta sección." />
      ) : (
        <ul className="divide-y divide-[var(--color-border)] -mx-5 border-y border-[var(--color-border)]">
          {metas.map((meta) => (
            <SettingRow
              key={meta.key}
              meta={meta}
              current={settingsByKey.get(meta.key)}
              onEdit={() => setEditKey(meta.key)}
            />
          ))}
        </ul>
      )}
      <EditSettingDrawer
        settingKey={editKey}
        open={!!editKey}
        onOpenChange={(o) => !o && setEditKey(null)}
        current={editKey ? settingsByKey.get(editKey) : undefined}
      />
    </SectionCard>
  );
}
