import { Module } from '@nestjs/common';
import { EmployeeSalariesController } from './employee-salaries.controller';
import { EmployeeSalariesService } from './employee-salaries.service';

/**
 * EmployeeSalariesModule — F1 sueldos por empleado en socios dep.
 *
 * No es @Global: nadie más inyecta el service todavía. Cuando el motor de
 * comisiones (F1 settle) empiece a descontar sueldos del NetWin del socio
 * dep dueño de la rama, va a importar este módulo o consumir la tabla
 * directamente vía el schema drizzle.
 *
 * TenantUsersModule está @Global → getRoles disponible sin re-importar.
 * AuditModule también → AuditLogService disponible.
 */
@Module({
  controllers: [EmployeeSalariesController],
  providers: [EmployeeSalariesService],
  exports: [EmployeeSalariesService],
})
export class EmployeeSalariesModule {}
