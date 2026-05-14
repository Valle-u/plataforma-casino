/**
 * DTO para PATCH /tenant/settings/:key
 */

import { IsDefined } from 'class-validator';

export class SetSettingDto {
  /**
   * El value puede ser cualquier JSON serializable — number, string,
   * boolean, object, array. La validación de shape específica por key
   * (e.g. fraud.suspected_threshold debe ser number 0-100) la hace el
   * consumer del setting cuando lo lee.
   */
  @IsDefined({ message: 'value es requerido (puede ser cualquier tipo JSON).' })
  value!: unknown;
}
