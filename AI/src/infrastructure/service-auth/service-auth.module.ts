import { Module } from '@nestjs/common';
import { ServiceAuthGuard } from './service-auth.guard';
import { TrustedContextVerifier } from './trusted-context.verifier';

/**
 * Machine-to-machine trust: the bearer guard for inbound backend calls and
 * the verifier for the user contexts the backend signs. Nothing about human
 * sessions lives here or anywhere else in this service.
 */
@Module({
  providers: [ServiceAuthGuard, TrustedContextVerifier],
  exports: [ServiceAuthGuard, TrustedContextVerifier],
})
export class ServiceAuthModule {}
