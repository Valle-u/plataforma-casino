/**
 * Vincular un bot de Telegram a la bandeja del operador (**2.5**).
 *
 * ## Lo que esta pantalla tiene que lograr, más allá del formulario
 *
 * **Que el operador entienda que el canal no arranca solo.** Por una
 * restricción de Telegram que no se puede saltear, **un bot sólo puede hablarle
 * a quien le escribió primero**: no hay forma de que inicie la conversación.
 *
 * Si eso no queda claro, el operador vincula el bot, no le escribe nadie, y
 * concluye que el CRM no funciona. Por eso el link ocupa el lugar central
 * después de vincular — no es un dato más, es **lo único que hace que el canal
 * exista**.
 *
 * ## Lo que NO muestra
 *
 * El token. La API no lo devuelve nunca: se guarda cifrado y no vuelve a salir
 * (**D20**). Si el operador lo pierde, lo saca de BotFather con `/mybots`.
 */

'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import {
  Check,
  Copy,
  Loader2,
  Plus,
  Send,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import {
  desvincularCanalDeTelegram,
  listarCanalesDeTelegram,
  vincularBotDeTelegram,
  type CanalDeTelegram,
} from '@/lib/chat/crm-api';

export function CanalesDeTelegram(): React.ReactElement {
  const [canales, setCanales] = useState<CanalDeTelegram[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarAlta, setMostrarAlta] = useState(false);
  const [token, setToken] = useState('');
  const [vinculando, setVinculando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setCanales(await listarCanalesDeTelegram());
    } catch {
      setCanales([]);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const vincular = useCallback(async () => {
    const limpio = token.trim();
    if (!limpio || vinculando) return;
    setVinculando(true);
    setError(null);
    try {
      await vincularBotDeTelegram(limpio);
      setToken('');
      setMostrarAlta(false);
      await cargar();
    } catch (err) {
      // El backend manda mensajes escritos para que se entiendan —qué forma
      // tiene un token, qué contestó Telegram—. Mostrarlos tal cual es mejor
      // que un "no se pudo" genérico.
      setError(mensajeDeError(err));
    } finally {
      setVinculando(false);
    }
  }, [token, vinculando, cargar]);

  const desvincular = useCallback(
    async (id: string) => {
      if (!window.confirm('¿Desvincular este bot? Deja de recibir mensajes.')) {
        return;
      }
      try {
        await desvincularCanalDeTelegram(id);
        await cargar();
      } catch (err) {
        setError(mensajeDeError(err));
      }
    },
    [cargar],
  );

  const copiar = useCallback(async (texto: string, id: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(id);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      /* sin portapapeles: el link está a la vista igual */
    }
  }, []);

  const activos = canales.filter((c) => c.isActive);

  return (
    <section style={seccion}>
      <div style={encabezado}>
        <div>
          <div style={titulo}>
            <Send size={15} /> Telegram
          </div>
          <div style={sub}>
            Un bot propio para que tus jugadores te escriban desde Telegram.
          </div>
        </div>
        {!mostrarAlta && (
          <button style={botonPrimario} onClick={() => setMostrarAlta(true)}>
            <Plus size={14} /> Vincular un bot
          </button>
        )}
      </div>

      {error && (
        <div style={avisoError}>
          <TriangleAlert size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      {mostrarAlta && (
        <div style={caja}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Cómo crear el bot
          </div>
          {/*
            Los pasos van acá y no en un link a la documentación de Telegram: el
            operador está en esta pantalla justamente porque no sabe cómo se
            hace, y mandarlo afuera es donde se pierde.
          */}
          <ol style={pasos}>
            <li>
              En Telegram, buscá <b>@BotFather</b> (el que tiene tilde azul).
            </li>
            <li>
              Mandale <code style={code}>/newbot</code> y seguí los dos pasos:
              un nombre visible y un usuario que termine en <b>bot</b>.
            </li>
            <li>Te va a responder con un token. Pegalo acá abajo.</li>
          </ol>

          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="7891234567:AAF-xYz..."
            style={input}
            autoComplete="off"
            spellCheck={false}
          />
          <div style={{ fontSize: 11, color: 'var(--color-fg-subtle)', marginTop: 6 }}>
            El token se guarda cifrado y no se muestra nunca más. Si lo perdés,
            lo volvés a ver en BotFather con <code style={code}>/mybots</code>.
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              style={{ ...botonPrimario, opacity: vinculando || !token.trim() ? 0.5 : 1 }}
              onClick={() => void vincular()}
              disabled={vinculando || !token.trim()}
            >
              {vinculando ? <Loader2 size={14} className="animate-spin" /> : null}
              {vinculando ? 'Vinculando…' : 'Vincular'}
            </button>
            <button
              style={botonSecundario}
              onClick={() => {
                setMostrarAlta(false);
                setToken('');
                setError(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {cargando ? (
        <div style={{ padding: 12 }}>
          <Loader2 size={16} className="animate-spin" style={{ opacity: 0.5 }} />
        </div>
      ) : activos.length === 0 ? (
        !mostrarAlta && (
          <div style={{ ...sub, padding: '10px 0' }}>
            Todavía no tenés ningún bot vinculado.
          </div>
        )
      ) : (
        activos.map((c) => (
          <div key={c.id} style={caja}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>@{c.username}</div>
              <button
                style={botonIcono}
                onClick={() => void desvincular(c.id)}
                title="Desvincular"
              >
                <Trash2 size={13} />
              </button>
            </div>

            {/*
              ⚠️ Lo más importante de la pantalla.

              Un bot NO puede iniciar una conversación: sólo responde a quien le
              escribió primero. Sin repartir este link, el canal queda vinculado
              y mudo — y el operador va a pensar que algo no anda.
            */}
            {c.link && (
              <div style={cajaLink}>
                <div style={{ fontSize: 12, marginBottom: 6 }}>
                  <b>Pasales este link a tus jugadores.</b> Un bot de Telegram
                  sólo puede responderle a quien le escribió primero, así que
                  hasta que alguien lo abra no va a entrar ningún mensaje.
                </div>
                <div style={filaLink}>
                  <code style={{ ...code, flex: 1, overflow: 'hidden' }}>
                    {c.link}
                  </code>
                  <button
                    style={botonSecundario}
                    onClick={() => void copiar(c.link!, c.id)}
                  >
                    {copiado === c.id ? <Check size={13} /> : <Copy size={13} />}
                    {copiado === c.id ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </section>
  );
}

/** El mensaje del backend si lo hay; si no, algo que se entienda. */
function mensajeDeError(err: unknown): string {
  const m = (err as { body?: { message?: string }; message?: string })?.body
    ?.message;
  if (typeof m === 'string' && m) return m;
  const directo = (err as { message?: string })?.message;
  return directo || 'No se pudo completar la operación.';
}

const seccion: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const encabezado: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
};
const titulo: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontWeight: 600,
  fontSize: 14,
};
const sub: CSSProperties = { fontSize: 12, color: 'var(--color-fg-muted)' };
const caja: CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: 12,
  background: 'var(--color-bg-elevated)',
};
const cajaLink: CSSProperties = {
  marginTop: 10,
  padding: 10,
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-info-bg)',
  borderLeft: '3px solid var(--color-info)',
};
const filaLink: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};
const pasos: CSSProperties = {
  margin: '0 0 12px',
  paddingLeft: 18,
  fontSize: 12,
  color: 'var(--color-fg-muted)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};
const input: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: 'var(--font-mono)',
  color: 'var(--color-fg)',
  background: 'var(--color-bg-subtle)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
};
const code: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--color-fg)',
};
const botonPrimario: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 12px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  color: 'var(--color-fg)',
  background: 'var(--color-bg-subtle)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 'var(--radius-sm)',
};
const botonSecundario: CSSProperties = {
  ...botonPrimario,
  fontWeight: 500,
  background: 'transparent',
};
const botonIcono: CSSProperties = {
  ...botonSecundario,
  padding: 5,
  color: 'var(--color-fg-muted)',
};
const avisoError: CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: 10,
  fontSize: 12,
  color: 'var(--color-warning)',
  background: 'var(--color-warning-bg)',
  borderLeft: '3px solid var(--color-warning)',
  borderRadius: 'var(--radius-sm)',
};
