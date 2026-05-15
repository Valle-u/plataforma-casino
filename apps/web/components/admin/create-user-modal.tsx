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
import { Eye, EyeOff, RefreshCw, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { isApiError } from '@/lib/api-client';
import { TENANT_ROLES } from '@/lib/constants';
import { useCreateUser } from '@/lib/hooks/use-users';

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
  const createUser = useCreateUser();

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
      };
      const result = await createUser.mutateAsync(payload);
      toast.success(`Usuario creado`, {
        description: `${result.user.username} fue dado de alta.`,
      });
      reset();
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

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

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
            {TENANT_ROLES.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label} ({r.code})
              </option>
            ))}
          </Select>
        </FormField>
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
    return 'No tenés permiso para crear usuarios.';
  }
  return err.message || 'Error inesperado.';
}
