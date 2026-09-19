import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app.config';
import { verifyTrustedContext, type TrustedContext } from './trusted-context';

/** The pure verifier, bound to this deployment's secret. */
@Injectable()
export class TrustedContextVerifier {
  constructor(private readonly config: AppConfig) {}

  verify(token: unknown, now: Date = new Date()): TrustedContext {
    return verifyTrustedContext(token, this.config.trustedContextSecret, now);
  }
}
