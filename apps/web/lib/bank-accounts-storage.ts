/**
 * Cuentas bancarias propias del tenant guardadas por dispositivo (Sprint 54).
 *
 * Decisión del dueño: la sección de transferencias se simplifica — el titular
 * y el banco de la cuenta propia se cargan una vez y quedan guardados para las
 * próximas transferencias. Se guardan en localStorage (por dispositivo, no
 * compartido entre operadores) y se persiste la última cuenta usada.
 */

export interface SavedBankAccount {
  id: string;
  bankName: string;
  accountHolder: string;
  updatedAt: number;
}

const ACCOUNTS_KEY = 'bank-tx:accounts-v1';
const LAST_ACCOUNT_KEY = 'bank-tx:last-account-v1';
/**
 * Sprint 56 (decisión dueño): el último "titular que envía/recibe" también
 * se guarda por dispositivo para autocompletar la carga en cadena.
 */
const LAST_COUNTERPARTY_KEY = 'bank-tx:last-counterparty-v1';

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage lleno/deshabilitado: no rompemos la carga.
  }
}

export function loadSavedAccounts(): SavedBankAccount[] {
  const raw = safeGet(ACCOUNTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is SavedBankAccount =>
        typeof a === 'object' &&
        a !== null &&
        typeof (a as SavedBankAccount).bankName === 'string' &&
        typeof (a as SavedBankAccount).accountHolder === 'string',
    );
  } catch {
    return [];
  }
}

function persist(accounts: SavedBankAccount[]): void {
  safeSet(ACCOUNTS_KEY, JSON.stringify(accounts));
}

/** Crea un id corto legible para la cuenta guardada. */
function makeId(): string {
  return `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Guarda una cuenta (titular + banco). Si ya existe exactamente igual, solo
 * actualiza updatedAt y devuelve la existente. Devuelve la cuenta resultante.
 */
export function upsertSavedAccount(
  bankName: string,
  accountHolder: string,
): SavedBankAccount {
  const accounts = loadSavedAccounts();
  const key = `${normalize(bankName)}|${normalize(accountHolder)}`;
  const existing = accounts.find(
    (a) => `${normalize(a.bankName)}|${normalize(a.accountHolder)}` === key,
  );
  if (existing) {
    const updated = { ...existing, updatedAt: Date.now() };
    persist(accounts.map((a) => (a.id === existing.id ? updated : a)));
    return updated;
  }
  const created: SavedBankAccount = {
    id: makeId(),
    bankName: bankName.trim(),
    accountHolder: accountHolder.trim(),
    updatedAt: Date.now(),
  };
  persist([created, ...accounts]);
  return created;
}

export function deleteSavedAccount(id: string): void {
  persist(loadSavedAccounts().filter((a) => a.id !== id));
  if (loadLastAccountId() === id) safeSet(LAST_ACCOUNT_KEY, '');
}

export function loadLastAccountId(): string | null {
  const raw = safeGet(LAST_ACCOUNT_KEY);
  return raw ? raw : null;
}

export function saveLastAccountId(id: string): void {
  safeSet(LAST_ACCOUNT_KEY, id);
}

/** Sprint 56: último titular que envió/recibió (contraparte). */
export function loadLastCounterparty(): string | null {
  const raw = safeGet(LAST_COUNTERPARTY_KEY);
  return raw ? raw : null;
}

export function saveLastCounterparty(name: string): void {
  safeSet(LAST_COUNTERPARTY_KEY, name.trim());
}
