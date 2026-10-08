import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../common/errors/domain.error';
import { isoDate } from '../../../common/pagination/date-range-page-query.dto';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { ProvisionedAccountGuard } from '../../../core/authorization/api/provisioned-account.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import { DriverOnlyGuard } from '../../../core/identity/api/driver-only.guard';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { DriverFuelService, type DriverFuelSubmissionDetail } from '../application/driver-fuel.service';
import { FuelEvidenceService } from '../application/fuel-evidence.service';
import { TRANSPORT_LIMIT_BYTES, type FuelEvidence } from '../domain/fuel-evidence';
import { FUEL_REVIEW_STATUSES, type DriverFuelSubmission, type FuelReviewStatus } from '../domain/fuel-review';
import { evidence, receiptFacts } from './fuel-transaction.dto';

interface UploadedEvidenceFile {
  buffer: Buffer;
  originalname?: string;
}

const STATUS = new Set<string>(FUEL_REVIEW_STATUSES);
const listSchema = z.object({
  /** `status=approved,paid` — one or more review states; absent, all of them. */
  status: z
    .string()
    .optional()
    .refine((value) => value === undefined || value.split(',').every((s) => STATUS.has(s)), 'Unknown status.'),
  day: isoDate,
});
type ListQuery = z.infer<typeof listSchema>;

const resubmitSchema = z.object({
  ...receiptFacts,
  occurredAt: z.coerce.date().optional(),
  evidence,
  note: z.string().trim().max(1000).optional(),
});
type ResubmitBody = z.infer<typeof resubmitSchema>;

/**
 * ★ THE DRIVER'S DOOR TO THEIR FUEL (0038) — NOT `cost.import`. A driver
 * account (`DriverOnlyGuard`), done with its temporary password, may upload
 * the photos of a fill, find again the ones it left waiting, open only images
 * it sent itself, read its own fills and — when Accounting asked — answer
 * one. The fill itself is recorded on the turn (`/driver/assignments/:id/
 * fuel-checks` and `…/fuel-transactions`), where the lorry and the day are
 * the server's. No ledger, no search, no other driver, no decision.
 */
@Controller('driver')
export class DriverFuelController {
  constructor(
    private readonly evidence: FuelEvidenceService,
    private readonly fills: DriverFuelService,
  ) {}

  @Post('fuel-evidence')
  @UseGuards(AuthGuard, CsrfGuard, DriverOnlyGuard, ProvisionedAccountGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: TRANSPORT_LIMIT_BYTES, files: 1, fields: 0 } }))
  async stage(@UploadedFile() file: UploadedEvidenceFile | undefined, @CurrentUser() actor: SessionUser): Promise<FuelEvidence> {
    if (!file) throw new ValidationError('Attach one image as the "file" field.', { file: 'REQUIRED' });
    return this.evidence.stage(file, actor.id);
  }

  /** The driver's own waiting photos — a closed app or a lost signal never strands them. */
  @Get('fuel-evidence/staged')
  @UseGuards(AuthGuard, DriverOnlyGuard, ProvisionedAccountGuard)
  async staged(@CurrentUser() actor: SessionUser): Promise<FuelEvidence[]> {
    return this.evidence.staged(actor.id);
  }

  @Post('fuel-evidence/:evidenceId/discard')
  @UseGuards(AuthGuard, CsrfGuard, DriverOnlyGuard, ProvisionedAccountGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async discard(@Param('evidenceId', UuidParam) evidenceId: string, @CurrentUser() actor: SessionUser): Promise<void> {
    await this.evidence.discard(evidenceId, actor.id);
  }

  @Get('fuel-evidence/:evidenceId/content')
  @UseGuards(AuthGuard, DriverOnlyGuard, ProvisionedAccountGuard)
  async content(
    @Param('evidenceId', UuidParam) evidenceId: string,
    @CurrentUser() actor: SessionUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const image = await this.evidence.contentOfUploader(evidenceId, actor.id);
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(image.stream, {
      type: image.mimeType,
      length: image.byteSize,
      disposition: `inline; filename="${image.filename}"`,
    });
  }

  @Get('fuel-submissions')
  @UseGuards(AuthGuard, DriverOnlyGuard, ProvisionedAccountGuard)
  async mine(
    @Query(new ZodValidationPipe(listSchema)) query: ListQuery,
    @CurrentUser() actor: SessionUser,
  ): Promise<DriverFuelSubmission[]> {
    return this.fills.mine(actor.id, {
      ...(query.status ? { statuses: query.status.split(',') as FuelReviewStatus[] } : {}),
      ...(query.day ? { businessDate: query.day } : {}),
    });
  }

  @Get('fuel-submissions/:fuelTransactionId')
  @UseGuards(AuthGuard, DriverOnlyGuard, ProvisionedAccountGuard)
  async detail(
    @Param('fuelTransactionId', UuidParam) fuelTransactionId: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<DriverFuelSubmissionDetail> {
    return this.fills.detail(actor.id, fuelTransactionId);
  }

  /** Answers Accounting's question: what was missing, and the fill goes back for checking. */
  @Post('fuel-submissions/:fuelTransactionId/resubmit')
  @UseGuards(AuthGuard, CsrfGuard, DriverOnlyGuard, ProvisionedAccountGuard)
  @HttpCode(HttpStatus.OK)
  async resubmit(
    @Param('fuelTransactionId', UuidParam) fuelTransactionId: string,
    @Body(new ZodValidationPipe(resubmitSchema)) body: ResubmitBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<DriverFuelSubmissionDetail> {
    const { evidence: images, note, ...facts } = body;
    return this.fills.resubmit(actor.id, fuelTransactionId, { facts, evidence: images, note });
  }
}
