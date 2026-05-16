/**
 * CsvExportButton — botón reusable para todos los listados del panel.
 *
 * Wraps `useCsvExport` + Button + toast feedback. Pasa el path del endpoint
 * y los filters actuales del listado (mismos params que usa el list view) —
 * el backend respeta esos filters y devuelve solo lo que matchea.
 *
 * Toast de éxito muestra cuántas filas se descargaron (lee X-Total-Rows
 * del response — pero como el blob ya pasó, lo aproximamos vía error/no-error).
 *
 * Manejo de errores específico:
 *   - 403 → "No tenés permiso para exportar." (común si el rol no tiene
 *     `<entity>.export`).
 *   - 0 / red → "Error de conexión."
 *   - otro → mostrar message del backend.
 */

'use client';

import { Download } from 'lucide-react';
import { toast } from 'sonner';
import {
  isCsvExportApiError,
  useCsvExport,
  type CsvExportOptions,
} from '@/lib/hooks/use-csv-export';
import { Button, type ButtonProps } from './button';
import { cn } from '@/lib/cn';

interface CsvExportButtonProps extends CsvExportOptions {
  /** Texto del botón. Default: 'Export CSV'. */
  label?: string;
  /** Variant del Button. Default 'secondary'. */
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
  /** Etiqueta humana para los toasts (e.g. "audit log", "depósitos"). */
  entityLabel?: string;
}

export function CsvExportButton({
  path,
  params,
  filenameHint,
  label = 'Export CSV',
  variant = 'secondary',
  size = 'md',
  className,
  entityLabel,
}: CsvExportButtonProps) {
  const { download, isLoading } = useCsvExport({ path, params, filenameHint });

  const handleClick = async () => {
    try {
      await download();
      toast.success('Export listo', {
        description: entityLabel
          ? `Archivo CSV de ${entityLabel} descargado.`
          : 'Archivo CSV descargado.',
      });
    } catch (err) {
      const description = mapError(err, entityLabel);
      toast.error('No se pudo exportar', { description });
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={isLoading}
      className={cn(className)}
    >
      {isLoading ? (
        <>
          <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
          Exportando…
        </>
      ) : (
        <>
          <Download className="size-3.5" />
          {label}
        </>
      )}
    </Button>
  );
}

function mapError(err: unknown, entityLabel?: string): string {
  if (!isCsvExportApiError(err)) return 'Error de conexión.';
  if (err.status === 403) {
    return `No tenés permiso para exportar${entityLabel ? ` ${entityLabel}` : ''}.`;
  }
  if (err.status === 401) return 'Sesión expirada. Re-ingresá.';
  if (err.status === 0) return 'Error de conexión.';
  return err.body?.message ?? err.message ?? 'Error inesperado.';
}
