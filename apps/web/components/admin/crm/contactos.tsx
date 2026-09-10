/**
 * Contactos — la agenda de la bandeja.
 *
 * ## Qué es, y qué no
 *
 * Es **la misma gente que la bandeja**, vista como lista en vez de como cola:
 * los que tienen alguna conversación asignada acá. No es el padrón de jugadores
 * del casino — para eso está Usuarios en el panel, con sus permisos.
 *
 * Por **D6** un mismo jugador tiene una ficha por bandeja, así que lo que se ve
 * acá ya está acotado sin ningún filtro extra.
 *
 * ## Una fila por persona, no por conversación
 *
 * Alguien que escribió por Telegram y por el widget tiene dos conversaciones y
 * **una sola fila**. "Abrir" lleva a la más reciente, que es la que uno quiere
 * ver cuando busca a alguien.
 *
 * ## Lo que el diseño pide y no está
 *
 * La columna **Etapa**. Ya existe —se calcula al mirar, ver `cteDeEtapas`— pero
 * vive en **Circuitos**, no acá: esta consulta agrupa por contacto y sumarle la
 * etapa significa meterle dos subconsultas por fila a una tabla que además se
 * busca con `LIKE`. Circuitos contesta la misma pregunta al derecho: en vez de
 * buscar a alguien para ver en qué etapa está, se entra por la etapa y salen
 * todos los que están ahí.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import {
  listarContactos,
  type ContactoDeBandeja,
  type PaginaDeContactos,
} from '@/lib/chat/crm-api';
import { canalVisible } from '@/lib/crm/canales';
import { cn } from '@/lib/cn';

export function Contactos(): React.ReactElement {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<PaginaDeContactos | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    // Se espera a que deje de escribir: sin esto, cada tecla es una consulta
    // con `LIKE` sobre la tabla entera.
    const t = setTimeout(() => {
      listarContactos({ search: busqueda, page: pagina })
        .then((d) => vivo && setDatos(d))
        .catch(() => vivo && setDatos(null))
        .finally(() => vivo && setCargando(false));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [busqueda, pagina]);

  const abrir = useCallback(
    (conversationId: string) => {
      // La bandeja lee `?conv=` al montar y abre esa conversación. Sin el
      // parámetro habría que compartir estado entre dos rutas, que para un
      // salto de una sola dirección es bastante más máquina de la que hace
      // falta.
      router.push(`/support?conv=${conversationId}`);
    },
    [router],
  );

  const total = datos?.total ?? 0;
  const porPagina = datos?.pageSize ?? 50;
  const ultimaPagina = Math.max(1, Math.ceil(total / porPagina));

  return (
    <div className="flex flex-col gap-4 py-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-[var(--color-fg)]">
          Contactos
        </h1>
        <p className="text-[12.5px] text-[var(--color-fg-muted)]">
          Todos los que te escribieron alguna vez. Es la misma gente de tu
          bandeja, ordenada por lo último que dijeron.
        </p>
      </div>

      <Indicadores items={datos?.items ?? []} total={total} />

      <div className="flex h-[38px] max-w-[420px] items-center gap-2 rounded-[11px] bg-[var(--color-bg-subtle)] px-2.5">
        <Search size={14} className="shrink-0 text-[var(--color-fg-subtle)]" />
        <input
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value);
            // Buscar desde la página 3 dejaría la lista vacía sin explicación.
            setPagina(1);
          }}
          placeholder="Buscar por nombre, usuario o teléfono"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-subtle)]"
        />
      </div>

      <div className="overflow-x-auto rounded-[14px] border border-[var(--color-border)]">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <Th>Contacto</Th>
              <Th>Canal</Th>
              <Th>Etiquetas</Th>
              <Th>Último mensaje</Th>
              <Th className="text-right">Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {cargando && !datos ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center">
                  <Loader2
                    size={16}
                    className="mx-auto animate-spin text-[var(--color-fg-subtle)]"
                  />
                </td>
              </tr>
            ) : (datos?.items.length ?? 0) === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-8 text-center text-[12.5px] text-[var(--color-fg-muted)]"
                >
                  {busqueda.trim()
                    ? 'Nadie coincide con esa búsqueda.'
                    : 'Todavía no te escribió nadie.'}
                </td>
              </tr>
            ) : (
              datos!.items.map((c) => (
                <Fila key={c.id} contacto={c} onAbrir={() => abrir(c.conversationId)} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > porPagina && (
        <div className="flex items-center justify-end gap-2 text-[12px] text-[var(--color-fg-muted)]">
          <span className="font-mono">
            {(pagina - 1) * porPagina + 1}–
            {Math.min(pagina * porPagina, total)} de {total}
          </span>
          <button
            type="button"
            disabled={pagina <= 1}
            onClick={() => setPagina((p) => p - 1)}
            className="rounded-[9px] border border-[var(--color-border)] px-2 py-1 disabled:opacity-40"
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={pagina >= ultimaPagina}
            onClick={() => setPagina((p) => p + 1)}
            className="rounded-[9px] border border-[var(--color-border)] px-2 py-1 disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Los cuatro números de arriba.
 *
 * ⚠️ Tres de los cuatro se calculan **sobre la página que se está viendo**, no
 * sobre el total: el backend manda 50 filas por vez y contar leads en el
 * servidor sería otra consulta. Se dice en el subtítulo — un número que parece
 * global y no lo es, es peor que no tenerlo.
 */
function Indicadores({
  items,
  total,
}: {
  items: ContactoDeBandeja[];
  total: number;
}): React.ReactElement {
  const leads = items.filter((c) => c.isLead).length;
  const jugadores = items.length - leads;
  const sinLeer = items.filter((c) => c.sinLeer > 0).length;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Indicador titulo="Contactos" valor={total} nota="en total" />
      <Indicador titulo="Jugadores" valor={jugadores} nota="en esta página" />
      <Indicador titulo="Leads" valor={leads} nota="en esta página" />
      <Indicador titulo="Sin leer" valor={sinLeer} nota="en esta página" />
    </div>
  );
}

function Indicador({
  titulo,
  valor,
  nota,
}: {
  titulo: string;
  valor: number;
  nota: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5 rounded-[13px] border border-[var(--color-border)] px-3 py-2.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
        {titulo}
      </span>
      <span className="font-display text-[23px] font-bold leading-none text-[var(--color-fg)]">
        {valor}
      </span>
      <span className="text-[11px] text-[var(--color-fg-subtle)]">{nota}</span>
    </div>
  );
}

function Fila({
  contacto,
  onAbrir,
}: {
  contacto: ContactoDeBandeja;
  onAbrir: () => void;
}): React.ReactElement {
  const canal = canalVisible(contacto.channelType);
  const nombre =
    contacto.userDisplayName ??
    contacto.username ??
    contacto.displayName ??
    contacto.phone ??
    (contacto.isLead ? 'Lead anónimo' : 'Jugador');

  return (
    <tr className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-bg-subtle)]">
      <Td>
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-[var(--color-fg)]">
            {nombre}
          </span>
          <span className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
            {contacto.username ?? contacto.phone ?? (contacto.isLead ? 'lead' : '')}
          </span>
        </div>
      </Td>
      <Td>
        <span className="flex items-center gap-1.5 text-[12px] text-[var(--color-fg-muted)]">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: canal.color }}
          />
          {canal.label || '—'}
        </span>
      </Td>
      <Td>
        {contacto.tags.length === 0 ? (
          <span className="text-[12px] text-[var(--color-fg-subtle)]">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {contacto.tags.map((t) => (
              <span
                key={t.id}
                className="rounded-[7px] px-1.5 py-px text-[10px] font-medium"
                style={{
                  color: t.color ?? 'var(--color-fg-muted)',
                  background: 'var(--color-bg-subtle)',
                }}
              >
                {t.label}
              </span>
            ))}
          </span>
        )}
      </Td>
      <Td>
        <span className="font-mono text-[11.5px] text-[var(--color-fg-muted)]">
          {cuando(contacto.lastMessageAt)}
        </span>
        {contacto.sinLeer > 0 && (
          <span className="ml-2 rounded-[7px] bg-[var(--color-accent)] px-1.5 py-px font-mono text-[10px] font-semibold text-[var(--color-accent-fg)]">
            {contacto.sinLeer}
          </span>
        )}
      </Td>
      <Td className="text-right">
        <button
          type="button"
          onClick={onAbrir}
          className="inline-flex items-center gap-1.5 rounded-[9px] border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-fg)] transition-colors hover:border-[var(--color-border-strong)]"
        >
          <ExternalLink size={12} />
          Abrir
        </button>
      </Td>
    </tr>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <th
      className={cn(
        'px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]',
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return <td className={cn('px-3 py-2.5 align-middle', className)}>{children}</td>;
}

/** Hora si es de hoy, fecha si es de antes. */
function cuando(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const hoy = new Date();
  return d.toDateString() === hoy.toDateString()
    ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
