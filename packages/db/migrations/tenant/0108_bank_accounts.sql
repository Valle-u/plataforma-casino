-- 0108 · Cuentas bancarias PROPIAS del tenant (bank_accounts).
--
-- Problema: al cargar una transferencia, el titular y el banco de NUESTRA
-- cuenta se escriben a mano en dos cajas de texto libre. Nada impide poner ahi
-- los datos de un tercero, y es lo que paso: en produccion hay una fila
-- `incoming` con account_holder = 'Juan Perez', que en las otras seis es el
-- sender_name (el que envia). El mismo nombre figura una vez como titular
-- nuestro y seis como contraparte.
--
-- Tampoco hay forma de saber cuales son nuestras cuentas: no existia el
-- concepto en ningun lado, ni tabla ni setting.
--
-- Solucion: definirlas una vez, elegirlas al cargar. El formulario deja de
-- aceptar texto libre en esa seccion.
--
-- Por que una tabla y no un setting JSON: son datos operativos con alta, baja
-- y edicion, referenciados desde transferencias que ya existen. Un JSON en
-- tenant_settings no da integridad ni historial, y editar a mano un array
-- para dar de baja una cuenta es justo el tipo de operacion donde se pierde
-- plata.
--
-- BAJA LOGICA (is_active), nunca DELETE: las transferencias viejas apuntan a
-- la cuenta con la que se operaron. Borrarla dejaria huerfano un dato de
-- auditoria de plata real.
CREATE TABLE IF NOT EXISTS bank_accounts (
  id uuid PRIMARY KEY,

  -- Nombre corto para reconocerla en el selector ("Mercado Pago principal").
  -- Es lo que ve el operador al cargar; el titular y el banco son el dato.
  label text NOT NULL,

  -- Los dos campos que terminan copiados en la transferencia.
  account_holder text NOT NULL,
  bank_name text NOT NULL,

  -- CBU / alias / codigo interno. Opcional: sirve para distinguir dos cuentas
  -- del mismo banco y a futuro para autocompletar `bank_transactions.
  -- bank_account`, que hoy esta vacio en TODAS las filas.
  account_identifier text,

  -- Baja logica. Una cuenta inactiva no se ofrece al cargar, pero las
  -- transferencias que la usaron la siguen mostrando.
  is_active boolean NOT NULL DEFAULT true,

  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- El selector pide las activas ordenadas por label.
CREATE INDEX IF NOT EXISTS bank_accounts_active_idx
  ON bank_accounts (label)
  WHERE is_active;

-- Dos cuentas no pueden compartir titular + banco + identificador: seria
-- imposible distinguirlas en el selector y se elegiria cualquiera. Parcial
-- sobre las activas -- una dada de baja puede repetirse si se recrea.
CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_unique_active
  ON bank_accounts (
    lower(trim(account_holder)),
    lower(trim(bank_name)),
    lower(trim(coalesce(account_identifier, '')))
  )
  WHERE is_active;
