/**
 * La bandeja del CRM: lista, conversación y ficha, en tres columnas.
 *
 * Es la pantalla principal del handoff (`docs/design_handoff_crm/`) y la razón
 * de que el shell tenga alto fijo: cada columna **scrollea por separado**, que
 * es lo que deja leer un hilo largo sin perder de vista la lista.
 *
 * ## Qué se puede colapsar, y qué no
 *
 * La lista y la ficha se colapsan a un riel de 46px. **La conversación no**:
 * es para lo que se abre la bandeja. Por eso el arrastre de las otras dos
 * respeta un piso — si al agrandar la lista la conversación quedaría más
 * angosta que `conversacionMinima`, el arrastre se frena solo.
 *
 * ## Mobile: una cosa por vez
 *
 * Abajo de 760px no hay tres columnas que valgan. Se ve **una sola**: la lista,
 * y al elegir una conversación, el hilo con una flecha para volver. Es el mismo
 * patrón que ya usaba la bandeja del panel, y el que la gente conoce de
 * cualquier app de mensajes.
 *
 * ## De dónde salen los datos
 *
 * De `useBandeja`, compartido con la bandeja del panel. Acá no hay socket ni
 * lógica de conversación: sólo cómo se muestra.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { useBandeja } from '@/lib/chat/use-bandeja';
import type { InboxItem } from '@/lib/chat/types';
import { cambiarEstadoDeConversacion } from '@/lib/chat/crm-api';
import { esAbrirPaleta, esFocoDeTexto } from '@/lib/crm/atajos';
import { useIsDesktop } from '@/lib/hooks/use-is-desktop';
import { cn } from '@/lib/cn';
import {
  LIMITES,
  RIEL,
  acotar,
  guardarLayout,
  leerLayout,
  type LayoutDeLaBandeja,
} from '@/lib/crm/layout-bandeja';
import { ListaDeConversaciones } from './lista-conversaciones';
import { Conversacion } from './conversacion';
import { RielColapsado } from './riel-colapsado';
import { Ficha } from './ficha';
import { Paleta } from './paleta';
import { AyudaDeAtajos } from './ayuda-atajos';

/**
 * Ancho de la manija de arrastre.
 *
 * Está acá y no suelto en la clase de Tailwind porque **el cálculo del piso de
 * la conversación tiene que restarlo**: son dos manijas entre tres columnas, y
 * sin contarlas el piso queda 10px corto.
 */
const ANCHO_MANIJA = 5;

/** Qué pestaña de la lista está activa. */
export type PestanaDeBandeja = 'abiertas' | 'esperando' | 'resueltas';

export function Bandeja(): React.ReactElement {
  const bandeja = useBandeja();
  const isDesktop = useIsDesktop();
  const contenedorRef = useRef<HTMLDivElement>(null);

  // El layout se lee después de montar: `localStorage` no existe en el
  // servidor, y sembrarlo desde ahí rompería la hidratación.
  const [layout, setLayout] = useState<LayoutDeLaBandeja | null>(null);
  useEffect(() => setLayout(leerLayout()), []);

  const actualizar = useCallback((cambio: Partial<LayoutDeLaBandeja>) => {
    setLayout((antes) => {
      if (!antes) return antes;
      const nuevo = { ...antes, ...cambio };
      guardarLayout(nuevo);
      return nuevo;
    });
  }, []);

  // ── Filtros de la lista ──────────────────────────────────────────────────
  const [pestana, setPestana] = useState<PestanaDeBandeja>('abiertas');
  const [canal, setCanal] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');

  const { verResueltas } = bandeja;
  const cambiarPestana = useCallback(
    (siguiente: PestanaDeBandeja) => {
      setPestana(siguiente);
      // "Resueltas" es OTRA consulta, no un filtro: ver `use-bandeja`.
      verResueltas(siguiente === 'resueltas');
    },
    [verResueltas],
  );

  // ── Arrastre ─────────────────────────────────────────────────────────────
  //
  // Se escucha en `window` y no en la manija: si el puntero se va más rápido
  // que el render —cosa habitual arrastrando— los eventos dejan de caer sobre
  // el elemento y el arrastre se corta a mitad de camino.
  const arrastre = useRef<{ cual: 'lista' | 'ficha'; x0: number; ancho0: number } | null>(null);

  const empezarArrastre = useCallback(
    (cual: 'lista' | 'ficha', e: React.MouseEvent) => {
      if (!layout) return;
      e.preventDefault();
      arrastre.current = {
        cual,
        x0: e.clientX,
        ancho0: cual === 'lista' ? layout.anchoLista : layout.anchoFicha,
      };
    },
    [layout],
  );

  useEffect(() => {
    const mover = (e: MouseEvent) => {
      const a = arrastre.current;
      if (!a || !contenedorRef.current) return;
      // La ficha crece hacia la IZQUIERDA: su ancho aumenta cuando el puntero
      // retrocede, al revés que la lista.
      const delta = a.cual === 'lista' ? e.clientX - a.x0 : a.x0 - e.clientX;
      const limite = a.cual === 'lista' ? LIMITES.lista : LIMITES.ficha;
      let ancho = acotar(a.ancho0 + delta, limite.min, limite.max);

      // El piso de la conversación gana sobre el rango de la columna que se
      // está moviendo: es la única que no se puede colapsar.
      const total = contenedorRef.current.clientWidth;
      setLayout((prev) => {
        if (!prev) return prev;
        const otra =
          a.cual === 'lista'
            ? prev.ficha
              ? prev.anchoFicha
              : RIEL
            : prev.lista
              ? prev.anchoLista
              : RIEL;
        // ⚠️ Las manijas también ocupan. Sin restarlas, la conversación termina
        // 10px por debajo del piso: poco, pero el piso deja de ser el piso y no
        // hay forma de darse cuenta mirando.
        const maximo =
          total - otra - ANCHO_MANIJA * 2 - LIMITES.conversacionMinima;
        ancho = Math.min(ancho, Math.max(limite.min, maximo));
        return a.cual === 'lista'
          ? { ...prev, anchoLista: ancho }
          : { ...prev, anchoFicha: ancho };
      });
    };
    const soltar = () => {
      if (!arrastre.current) return;
      arrastre.current = null;
      // Se guarda al soltar y no en cada `mousemove`: escribir en
      // `localStorage` sesenta veces por segundo traba el arrastre.
      setLayout((prev) => {
        if (prev) guardarLayout(prev);
        return prev;
      });
    };
    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
    return () => {
      window.removeEventListener('mousemove', mover);
      window.removeEventListener('mouseup', soltar);
    };
  }, []);

  // ── Atajos de teclado ────────────────────────────────────────────────────
  //
  // ⚠️ **Lo primero es no robarle las teclas a quien está escribiendo.** `e`
  // resuelve la conversación y `r` salta al compositor: sin el guard de foco,
  // escribir "espera" la cerraría en la primera letra. Ver `lib/crm/atajos.ts`.
  const [paletaAbierta, setPaletaAbierta] = useState(false);
  const [ayudaAbierta, setAyudaAbierta] = useState(false);

  const { selectConversation, selectedId, textareaRef, marcarEstadoLocal } = bandeja;

  useEffect(() => {
    const alTeclado = (e: KeyboardEvent) => {
      // ⌘K va SIEMPRE, incluso escribiendo: lleva modificador, así que no
      // choca con nada, y quien redacta una respuesta también quiere poder
      // saltar a otra conversación.
      if (esAbrirPaleta(e)) {
        e.preventDefault();
        setPaletaAbierta(true);
        return;
      }

      if (e.key === 'Escape') {
        setPaletaAbierta(false);
        setAyudaAbierta(false);
        return;
      }

      // De acá para abajo, teclas sueltas: no corren dentro de un campo, ni
      // con un modificador apretado (sería un atajo del navegador).
      if (esFocoDeTexto(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (paletaAbierta || ayudaAbierta) return;

      const k = e.key.toLowerCase();

      if (k === 'j' || k === 'k') {
        e.preventDefault();
        const i = visiblesRef.current.findIndex(
          (c) => c.conversation.id === selectedId,
        );
        const siguiente =
          k === 'j'
            ? Math.min(i + 1, visiblesRef.current.length - 1)
            : Math.max(i - 1, 0);
        const destino = visiblesRef.current[i === -1 ? 0 : siguiente];
        if (destino) selectConversation(destino.conversation.id);
        return;
      }

      if (k === 'r' || k === '/') {
        e.preventDefault();
        textareaRef.current?.focus();
        return;
      }

      if (k === 'f') {
        e.preventDefault();
        setLayout((prev) => {
          if (!prev) return prev;
          const nuevo = { ...prev, ficha: !prev.ficha };
          guardarLayout(nuevo);
          return nuevo;
        });
        return;
      }

      if (k === 'e' && selectedId) {
        e.preventDefault();
        // Resolver desde el teclado pasa por el mismo endpoint que el botón.
        void cambiarEstadoDeConversacion(selectedId, 'resolved')
          .then((r) => marcarEstadoLocal(r.status))
          .catch(() => undefined);
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setAyudaAbierta(true);
      }
    };
    window.addEventListener('keydown', alTeclado);
    return () => window.removeEventListener('keydown', alTeclado);
  }, [
    selectedId,
    selectConversation,
    textareaRef,
    marcarEstadoLocal,
    paletaAbierta,
    ayudaAbierta,
  ]);

  // ── Filtrado de la lista ─────────────────────────────────────────────────
  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return bandeja.conversations.filter((item) => {
      // "Resueltas" ya vino filtrada del servidor; las otras dos se separan
      // acá porque salen de la misma consulta.
      if (pestana === 'abiertas' && item.conversation.status === 'pending') {
        return false;
      }
      if (pestana === 'esperando' && item.conversation.status !== 'pending') {
        return false;
      }
      if (canal && item.channelType !== canal) return false;
      if (!texto) return true;
      const c = item.contact;
      return [c.userDisplayName, c.username, c.displayName, c.phone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(texto));
    });
  }, [bandeja.conversations, pestana, canal, busqueda]);

  // Un espejo de la lista visible, para que `j`/`k` lean la de AHORA. El
  // listener del teclado se registra una vez y capturaría el array viejo.
  const visiblesRef = useRef<InboxItem[]>([]);
  visiblesRef.current = visibles;

  // Los dos modales van juntos y por fuera del layout: se abren desde el
  // teclado, así que tienen que existir tanto en escritorio como en mobile.
  const modales = (
    <>
      {paletaAbierta && (
        <Paleta
          conversaciones={bandeja.conversations}
          onElegirConversacion={selectConversation}
          onCerrar={() => setPaletaAbierta(false)}
        />
      )}
      {ayudaAbierta && <AyudaDeAtajos onCerrar={() => setAyudaAbierta(false)} />}
    </>
  );

  // Hasta que el layout se lee, no se pinta nada: dibujar con los anchos por
  // defecto y corregirlos un frame después es un salto visible.
  if (!layout) return <div className="h-full" />;

  // ── Mobile: una vista por vez ────────────────────────────────────────────
  if (!isDesktop) {
    return (
      <div className="flex h-full flex-col">
        {bandeja.selectedId ? (
          <Conversacion
            bandeja={bandeja}
            onVolver={() => bandeja.setSelectedId(null)}
            fichaAbierta={false}
            onAlternarFicha={() => undefined}
          />
        ) : (
          <ListaDeConversaciones
            items={visibles}
            total={bandeja.conversations.length}
            seleccionada={bandeja.selectedId}
            onElegir={bandeja.selectConversation}
            pestana={pestana}
            onPestana={cambiarPestana}
            canal={canal}
            onCanal={setCanal}
            busqueda={busqueda}
            onBusqueda={setBusqueda}
            densa={layout.densa}
            onDensa={() => actualizar({ densa: !layout.densa })}
            onColapsar={null}
            cargando={bandeja.cargandoLista}
            estado={bandeja.status}
          />
        )}
        {modales}
      </div>
    );
  }

  return (
    <div ref={contenedorRef} className="flex h-full">
      {layout.lista ? (
        <>
          <div style={{ width: layout.anchoLista }} className="shrink-0">
            <ListaDeConversaciones
              items={visibles}
              total={bandeja.conversations.length}
              seleccionada={bandeja.selectedId}
              onElegir={bandeja.selectConversation}
              pestana={pestana}
              onPestana={cambiarPestana}
              canal={canal}
              onCanal={setCanal}
              busqueda={busqueda}
              onBusqueda={setBusqueda}
              densa={layout.densa}
              onDensa={() => actualizar({ densa: !layout.densa })}
              onColapsar={() => actualizar({ lista: false })}
              cargando={bandeja.cargandoLista}
              estado={bandeja.status}
            />
          </div>
          <Manija onMouseDown={(e) => empezarArrastre('lista', e)} />
        </>
      ) : (
        <RielColapsado
          titulo="Conversaciones"
          contador={bandeja.conversations.length}
          onAbrir={() => actualizar({ lista: true })}
          lado="izquierda"
        />
      )}

      <div className="min-w-0 flex-1">
        {bandeja.selectedId ? (
          <Conversacion
            bandeja={bandeja}
            onVolver={null}
            fichaAbierta={layout.ficha}
            onAlternarFicha={() => actualizar({ ficha: !layout.ficha })}
          />
        ) : (
          <SinConversacion />
        )}
      </div>

      {layout.ficha ? (
        <>
          <Manija onMouseDown={(e) => empezarArrastre('ficha', e)} />
          <div
            style={{ width: layout.anchoFicha }}
            className="shrink-0 overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)]"
          >
            {bandeja.selected ? (
              <Ficha
                item={bandeja.selected}
                onEstadoCambiado={bandeja.marcarEstadoLocal}
              />
            ) : (
              <SinFicha />
            )}
          </div>
        </>
      ) : (
        <RielColapsado
          titulo="Ficha"
          contador={null}
          onAbrir={() => actualizar({ ficha: true })}
          lado="derecha"
        />
      )}

      {modales}
    </div>
  );
}

/**
 * La manija entre dos columnas.
 *
 * 5px de ancho y sin contenido: lo único que hace es capturar el `mousedown`.
 * El resaltado al pasar por encima existe para que se note que se puede
 * arrastrar — sin eso, la única pista sería el cursor.
 */
function Manija({
  onMouseDown,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
}): React.ReactElement {
  return (
    <div
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="vertical"
      style={{ width: ANCHO_MANIJA }}
      className="shrink-0 cursor-col-resize bg-[var(--color-border)] transition-colors hover:bg-[var(--color-accent)]"
    />
  );
}

/** Lo que se ve mientras no hay ninguna conversación elegida. */
function SinConversacion(): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <MessageCircle size={30} className="text-[var(--color-fg-subtle)] opacity-50" />
      <p className="max-w-[280px] text-[13px] text-[var(--color-fg-muted)]">
        Elegí una conversación de la lista para leerla y responder.
      </p>
    </div>
  );
}

/**
 * La ficha con la columna abierta pero sin conversación elegida.
 *
 * No se colapsa sola: el operador decidió tenerla abierta, y cerrársela porque
 * en este instante no hay nada que mostrar le movería el layout abajo de los
 * pies cada vez que resuelve una conversación.
 */
function SinFicha(): React.ReactElement {
  return (
    <div className={cn('flex h-full items-center justify-center px-4')}>
      <p className="text-center text-[12px] text-[var(--color-fg-subtle)]">
        Elegí una conversación para ver la ficha del contacto.
      </p>
    </div>
  );
}
