import { Module } from '@nestjs/common';
import { ServiceAuthGuard } from './service-auth.guard';
import { TrustedContextSigner } from './trusted-context.signer';

/**
 * Machine-to-machine trust with the AI Platform (ADR-0007): the guard for
 * inbound AI calls and the signer for outbound user contexts. Registered in
 * the composition root; consumed by nothing until Phase 1b/1c, on purpose —
 * the boundary exists before the first route that crosses it.
 */
@Module({
  providers: [ServiceAuthGuard, TrustedContextSigner],
  exports: [ServiceAuthGuard, TrustedContextSigner],
})
export class ServiceAuthModule {}
