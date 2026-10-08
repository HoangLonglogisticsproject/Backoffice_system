import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ValidationError } from '../../../common/errors/domain.error';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { PermissionGuard, RequirePermission } from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { BackofficeOnlyGuard } from '../../../core/identity/api/backoffice-only.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { FuelEvidenceService } from '../application/fuel-evidence.service';
import { TRANSPORT_LIMIT_BYTES, type FuelEvidence } from '../domain/fuel-evidence';
import { retireSchema, type RetireBody } from './fuel-transaction.dto';

/** The part of a multer file this route reads. Typed here, so no `@types/multer`. */
interface UploadedEvidenceFile {
  buffer: Buffer;
  originalname?: string;
}

/**
 * Fuel evidence images (0037), staged and served by the backend alone.
 *
 * ★ THE GUARDS RUN BEFORE THE FILE IS READ. Nest applies guards before
 * interceptors, so a caller without `cost.import` is refused before multer
 * buffers a byte. One file per request, no other fields, held in memory up to
 * the 2 MiB nginx already allows; the 2 MB business cap is the service's.
 *
 * ★ NO URL EVER LEAVES. An image is streamed through `content` to a caller the
 * guards have just authorised — `private, no-store`, named by its id, typed by
 * the format its bytes proved at upload.
 */
@Controller('fuel-evidence')
export class FuelEvidenceController {
  constructor(private readonly evidence: FuelEvidenceService) {}

  @Post()
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: TRANSPORT_LIMIT_BYTES, files: 1, fields: 0 } }))
  async stage(
    @UploadedFile() file: UploadedEvidenceFile | undefined,
    @CurrentUser() actor: SessionUser,
  ): Promise<FuelEvidence> {
    if (!file) throw new ValidationError('Attach one image as the "file" field.', { file: 'REQUIRED' });
    return this.evidence.stage(file, actor.id);
  }

  @Post(':evidenceId/discard')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.import')
  @HttpCode(HttpStatus.NO_CONTENT)
  async discard(
    @Param('evidenceId', UuidParam) evidenceId: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<void> {
    await this.evidence.discard(evidenceId, actor.id);
  }

  @Get(':evidenceId/content')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.import')
  async content(
    @Param('evidenceId', UuidParam) evidenceId: string,
    @CurrentUser() actor: SessionUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const image = await this.evidence.content(evidenceId, actor.id);
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(image.stream, {
      type: image.mimeType,
      length: image.byteSize,
      disposition: `inline; filename="${image.filename}"`,
    });
  }

  /** Withdraws an attached image with a reason — the SuperAdmin's (`cost.void`). */
  @Post(':evidenceId/retire')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('cost.void')
  @HttpCode(HttpStatus.OK)
  async retire(
    @Param('evidenceId', UuidParam) evidenceId: string,
    @Body(new ZodValidationPipe(retireSchema)) body: RetireBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<FuelEvidence> {
    return this.evidence.retire(evidenceId, body.reason, actor.id);
  }
}
