/**
 * CreateUserModal — flow de creación de user nuevo.
 *
 * Espeja el `CreateTenantUserDto` del backend. Validación Zod local —
 * cuando el backend pasa a Zod schemas tenant-shared, podemos importarlos.
 *
 * UX: campos requeridos marcados con asterisco rojo. Helper text debajo
 * para password y username (constraints). Errores del server (409 dup,
 * 400 validation) se mapean a mensajes amigables.
 *
 * Toast: success → "Usuario creado", error → mensaje del server.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LayoutTemplate,
  Minus,
  RefreshCw,
  UserPlus,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { TENANT_ROLES, assignableRoles } from '@/lib/constants';
import {
  useGrantableByMe,
  usePermissionsCatalog,
  type PermissionDef,
} from '@/lib/hooks/use-permissions';
import { useCreateUser } from '@/lib/hooks/use-users';
import { getCategoryLabel, getPermissionMeta } from '@/lib/permission-meta';
import { RiskBadge } from '@/components/admin/permission-info';
import {
  PERMISSION_TEMPLATES,
  filterByGrantable,
  getTemplate,
} from '@/lib/permission-templates';
import { cn } from '@/lib/cn';

const schema = z.object({
  username: z
    .string()
    .min(3, 'Mínimo 3 caracteres.')
    .max(30, 'Máximo 30 caracteres.')
    .regex(/^[a-z0-9._-]+$/, 'Solo minúsculas, dígitos, punto, guión y guión bajo.'),
  password: z
    .string()
    .min(8, 'Mínimo 8 caracteres.')
    .max(72, 'Máximo 72 caracteres.'),
  displayName: z
    .string()
    .min(1, 'Requerido.')
    .max(100, 'Máximo 100 caracteres.'),
  email: z.string().email('Email inválido.').optional().or(z.literal('')),
  phone: z
    .string()
    .max(30, 'Máximo 30 caracteres.')
    .optional()
    .or(z.literal('')),
  roleCode: z.string().min(1, 'Seleccioná un rol.'),
});

type FormValues = z.infer<typeof schema>;

interface CreateUserModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateUserModal({ open, onOpenChange }: CreateUserModalProps) {
  const [showPassword, setShowPassword] = useState(false);
  // Sprint 51.5: selected permission codes para empleados.
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());
  // Planilla activa (id) — al elegirla auto-tilda el set. El admin puede
  // agregar/quitar perms libremente después.
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  // Perms de la planilla que quedaron afuera porque el actor no puede
  // delegarlos. Se muestran al pie del card informativo.
  const [templateSkipped, setTemplateSkipped] = useState<string[]>([]);
  const createUser = useCreateUser();

  // Roles que ESTE actor puede crear: solo los por debajo del suyo en la
  // jerarquía (el admin ve todos). Un socio no debe ver "admin"/"socio", un
  // cajero no debe ver la estructura hacia arriba. El backend revalida
  // (403 ROLE_NOT_ASSIGNABLE) — acá solo evitamos mostrar opciones inválidas.
  const { user } = useAuth();
  const availableRoles = useMemo(
    () => assignableRoles(user?.roles ?? []),
    [user?.roles],
  );

  // Sprint 51.5: para empleados, listamos los permisos que el actor PUEDE
  // otorgar (su set efectivo ∩ delegables). El catálogo nos da los labels.
  const grantable = useGrantableByMe();
  const catalog = usePermissionsCatalog();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      username: '',
      password: '',
      displayName: '',
      email: '',
      phone: '',
      roleCode: 'usuario_final',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const payload = {
        username: values.username,
        password: values.password,
        displayName: values.displayName,
        email: values.email || undefined,
        phone: values.phone || undefined,
        roleCode: values.roleCode,
        permissionOverrides:
          values.roleCode === 'empleado' && selectedPerms.size > 0
            ? [...selectedPerms]
            : undefined,
      };
      const result = await createUser.mutateAsync(payload);
      const grantedCount = result.permissionOverrides?.length ?? 0;
      const deniedCount = result.permissionDenied?.length ?? 0;
      // F1.1a — si aplicó la política de rama dependiente, avisamos que
      // el empleado quedó sin los perms económicos peligrosos por default.
      let description: string;
      if (grantedCount > 0 && deniedCount > 0) {
        description = `${result.user.username} alta con ${grantedCount} permisos otorgados y ${deniedCount} bloqueados por default (rama dependiente).`;
      } else if (grantedCount > 0) {
        description = `${result.user.username} alta con ${grantedCount} permisos.`;
      } else if (deniedCount > 0) {
        description = `${result.user.username} alta. Se bloquearon ${deniedCount} permisos económicos por default (rama dependiente).`;
      } else {
        description = `${result.user.username} fue dado de alta.`;
      }
      toast.success(`Usuario creado`, { description });
      reset();
      setSelectedPerms(new Set());
      setSelectedTemplateId('');
      setTemplateSkipped([]);
      onOpenChange(false);
    } catch (err) {
      const msg = mapServerError(err);
      toast.error('No se pudo crear el usuario', { description: msg });
    }
  });

  const generatePassword = () => {
    const chars =
      'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let result = '';
    for (let i = 0; i < 14; i += 1) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    setValue('password', result, { shouldValidate: true, shouldDirty: true });
    setShowPassword(true);
  };

  const selectedRole = watch('roleCode');
  const roleDesc = TENANT_ROLES.find((r) => r.code === selectedRole)?.description;
  const isEmpleado = selectedRole === 'empleado';

  // Cuando el rol cambia a no-empleado, limpiamos la planilla activa
  // para que si vuelven a elegir empleado, no aparezca stale.
  useEffect(() => {
    if (!isEmpleado) {
      setSelectedTemplateId('');
      setTemplateSkipped([]);
    }
  }, [isEmpleado]);

  // Map de permisos otorgables agrupados por categoría — solo para empleado.
  const grantableGrouped = useMemo(() => {
    if (!isEmpleado) return null;
    const grantableSet = new Set(grantable.data?.data ?? []);
    const defs = catalog.data?.data ?? [];
    const onlyGrantable = defs.filter((d) => grantableSet.has(d.code));
    const byCategory = new Map<string, PermissionDef[]>();
    for (const d of onlyGrantable) {
      const cat = d.category ?? 'otros';
      const list = byCategory.get(cat) ?? [];
      list.push(d);
      byCategory.set(cat, list);
    }
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [isEmpleado, grantable.data, catalog.data]);

  const togglePerm = (code: string) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleCategory = (codes: string[], allOn: boolean) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (allOn) codes.forEach((c) => next.delete(c));
      else codes.forEach((c) => next.add(c));
      return next;
    });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset();
      setSelectedPerms(new Set());
      setSelectedTemplateId('');
      setTemplateSkipped([]);
    }
    onOpenChange(next);
  };

  const applyTemplate = (id: string) => {
    setSelectedTemplateId(id);
    if (!id) {
      setTemplateSkipped([]);
      return;
    }
    const tpl = getTemplate(id);
    if (!tpl) return;
    const grantableSet = new Set(grantable.data?.data ?? []);
    const { applicable, skipped } = filterByGrantable(tpl, grantableSet);
    setSelectedPerms(new Set(applicable.map((p) => p.code)));
    setTemplateSkipped(skipped.map((p) => p.code));
  };

  const activeTemplate = selectedTemplateId
    ? getTemplate(selectedTemplateId)
    : null;

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Crear usuario"
      description="Completá los datos del nuevo usuario y asignale un rol."
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={createUser.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="create-user-form"
            disabled={createUser.isPending}
          >
            {createUser.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Creando…
              </>
            ) : (
              <>
                <UserPlus className="size-3.5" />
                Crear usuario
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="create-user-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        <FormField
          id="cu-username"
          label="Usuario"
          required
          error={errors.username?.message}
          hint="3-30 caracteres. Minúsculas, dígitos, . _ -"
        >
          <Input
            id="cu-username"
            type="text"
            autoComplete="off"
            invalid={!!errors.username}
            {...register('username')}
          />
        </FormField>

        <FormField
          id="cu-password"
          label="Contraseña"
          required
          error={errors.password?.message}
          hint="Mínimo 8 caracteres."
        >
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <Input
                id="cu-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                invalid={!!errors.password}
                className="pr-9 font-mono"
                {...register('password')}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 size-6 flex items-center justify-center text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors"
                aria-label={showPassword ? 'Ocultar' : 'Mostrar'}
              >
                {showPassword ? (
                  <EyeOff className="size-3.5" />
                ) : (
                  <Eye className="size-3.5" />
                )}
              </button>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={generatePassword}
              title="Generar contraseña random"
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        </FormField>

        <FormField
          id="cu-displayName"
          label="Nombre visible"
          required
          error={errors.displayName?.message}
        >
          <Input
            id="cu-displayName"
            type="text"
            autoComplete="off"
            invalid={!!errors.displayName}
            {...register('displayName')}
          />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            id="cu-email"
            label="Email"
            error={errors.email?.message}
            hint="Opcional"
          >
            <Input
              id="cu-email"
              type="email"
              autoComplete="off"
              invalid={!!errors.email}
              {...register('email')}
            />
          </FormField>

          <FormField
            id="cu-phone"
            label="Teléfono"
            error={errors.phone?.message}
            hint="Opcional · E.164 si vas a usar SMS"
          >
            <Input
              id="cu-phone"
              type="tel"
              autoComplete="off"
              invalid={!!errors.phone}
              {...register('phone')}
            />
          </FormField>
        </div>

        <FormField
          id="cu-roleCode"
          label="Rol"
          required
          error={errors.roleCode?.message}
          hint={roleDesc}
        >
          <Select
            id="cu-roleCode"
            invalid={!!errors.roleCode}
            {...register('roleCode')}
          >
            {availableRoles.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label} ({r.code})
              </option>
            ))}
          </Select>
        </FormField>

        {/* Selector de planilla — carga un set predefinido de permisos según
            la función del empleado. El admin puede modificarlo antes de crear. */}
        {isEmpleado && (
          <FormField
            id="cu-template"
            label="Planilla (opcional)"
            hint="Preselecciona un set de permisos según la función del empleado. Podés ajustar después."
          >
            <Select
              id="cu-template"
              value={selectedTemplateId}
              onChange={(e) => applyTemplate(e.target.value)}
            >
              <option value="">Ninguna (elegir manual)</option>
              {PERMISSION_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        {/* Card informativo de la planilla activa. */}
        {isEmpleado && activeTemplate && (
          <div className="flex flex-col gap-2 p-3 rounded-[var(--radius)] border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)]">
            <div className="flex items-center gap-2">
              <LayoutTemplate className="size-3.5 text-[var(--color-accent-text)]" />
              <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium">
                {activeTemplate.nombre}
              </span>
            </div>
            <p className="text-[12px] text-[var(--color-fg-muted)] leading-snug">
              {activeTemplate.descripcion}
            </p>
            {activeTemplate.caveat && (
              <div className="flex items-start gap-2 px-2 py-1.5 rounded-[var(--radius-sm)] border border-[var(--color-warning)]/40 bg-[var(--color-warning-bg)]">
                <AlertTriangle className="size-3.5 mt-0.5 shrink-0 text-[var(--color-warning)]" />
                <p className="text-[11px] text-[var(--color-fg)] leading-snug">
                  {activeTemplate.caveat}
                </p>
              </div>
            )}
            {templateSkipped.length > 0 && (
              <div className="flex flex-col gap-1 pt-1.5 border-t border-[var(--color-border)]">
                <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)]">
                  {templateSkipped.length} permiso{templateSkipped.length === 1 ? '' : 's'} de la planilla no aplicado{templateSkipped.length === 1 ? '' : 's'}
                </span>
                <span className="text-[10px] text-[var(--color-fg-subtle)] leading-tight">
                  No podés delegarlos con tu rol actual — el empleado va a
                  crearse sin esos codes. Pedile a un admin que los otorgue
                  después si hacen falta.
                </span>
                <div className="flex flex-wrap gap-1 pt-1">
                  {templateSkipped.map((code) => (
                    <span
                      key={code}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded-md border border-[var(--color-border-strong)] text-[var(--color-fg-muted)]"
                    >
                      {code}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sprint 51.5: checkbox list de permisos para empleado.
            El backend valida que el actor TENGA cada permiso seleccionado;
            el endpoint /grantable-by-me ya filtra al subset válido pero
            la validación final es server-side (defensa en profundidad). */}
        {isEmpleado && (
          <div className="flex flex-col gap-2 p-3 rounded-[var(--radius)] bg-[var(--color-bg)] border border-[var(--color-border)]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] font-medium flex items-center gap-1.5">
                <KeyRound className="size-3" />
                Permisos del empleado ({selectedPerms.size} seleccionados)
              </span>
              {selectedPerms.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedPerms(new Set())}
                  className="text-[10px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                >
                  Limpiar
                </button>
              )}
            </div>
            <span className="text-[10px] text-[var(--color-fg-subtle)]">
              Solo aparecen los permisos que vos podés delegar. El empleado
              no podrá sub-delegar lo que reciba.
            </span>

            {grantable.isLoading || catalog.isLoading ? (
              <Skeleton className="h-32" />
            ) : !grantableGrouped || grantableGrouped.length === 0 ? (
              <div className="text-[11px] text-[var(--color-fg-muted)] italic p-3 bg-[var(--color-bg-subtle)]">
                No tenés permisos delegables para asignar. El empleado va a
                crearse sin permisos — podés grantear después desde su perfil.
              </div>
            ) : (
              <div className="flex flex-col gap-3 max-h-[280px] overflow-y-auto pt-1">
                {grantableGrouped.map(([category, perms]) => {
                  const codes = perms.map((p) => p.code);
                  const allOn = codes.every((c) => selectedPerms.has(c));
                  const someOn = codes.some((c) => selectedPerms.has(c));
                  return (
                    <div key={category} className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => toggleCategory(codes, allOn)}
                        className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] self-start"
                      >
                        <span
                          className={cn(
                            'size-3 border border-[var(--color-border-strong)] flex items-center justify-center',
                            allOn && 'bg-[var(--color-accent)] border-[var(--color-accent)] text-[var(--color-accent-fg)]',
                            !allOn && someOn && 'bg-[var(--color-bg-subtle)]',
                          )}
                        >
                          {allOn ? (
                            <Check className="size-2.5" strokeWidth={3} />
                          ) : someOn ? (
                            <Minus className="size-2.5" strokeWidth={3} />
                          ) : null}
                        </span>
                        {getCategoryLabel(category)}
                      </button>
                      <div className="flex flex-col gap-0.5 pl-5">
                        {perms.map((p) => {
                          const checked = selectedPerms.has(p.code);
                          const meta = getPermissionMeta(p.code);
                          return (
                            <label
                              key={p.code}
                              className={cn(
                                'flex items-start gap-2 py-1.5 px-2 -mx-2 cursor-pointer hover:bg-[var(--color-bg-subtle)] transition-colors',
                                checked && 'bg-[var(--color-bg-subtle)]',
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => togglePerm(p.code)}
                                className="mt-1 accent-[var(--color-accent)]"
                              />
                              <div className="flex flex-col gap-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[12px] font-medium text-[var(--color-fg)] tracking-tight">
                                    {meta.label}
                                  </span>
                                  <RiskBadge risk={meta.risk} />
                                </div>
                                <span className="text-[11px] text-[var(--color-fg-muted)] leading-tight">
                                  {meta.what}
                                </span>
                                <span className="text-[10px] text-[var(--color-fg-subtle)] leading-tight">
                                  Qué puede pasar: {meta.consequence}
                                </span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}

function mapServerError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 409) {
    return 'Ya existe un usuario con ese username o email.';
  }
  if (err.status === 400) {
    return err.message || 'Datos inválidos.';
  }
  if (err.status === 403) {
    // El backend manda mensaje específico para ROLE_NOT_ASSIGNABLE (intento
    // de asignar un rol por encima del propio). Lo surfaceamos si viene.
    return err.message || 'No tenés permiso para crear usuarios.';
  }
  return err.message || 'Error inesperado.';
}
