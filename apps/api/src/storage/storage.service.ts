import { Injectable, Logger } from '@nestjs/common';

export interface UploadInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  keyPrefix: string;
  tenantSlug: string;
}

export interface UploadResult {
  url: string;
  storageKey: string;
  sizeBytes: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  async upload(input: UploadInput): Promise<UploadResult> {
    const key = `${input.keyPrefix}/${input.tenantSlug}/${Date.now()}_${input.originalName}`;
    this.logger.warn(`StorageService.upload stub — not persisted: ${key}`);
    return {
      url: `https://stub.storage/${key}`,
      storageKey: key,
      sizeBytes: input.buffer.length,
    };
  }

  async getUrl(storageKey: string): Promise<string> {
    return `https://stub.storage/${storageKey}`;
  }

  async delete(storageKey: string): Promise<void> {
    this.logger.warn(`StorageService.delete stub — not deleted: ${storageKey}`);
  }
}
