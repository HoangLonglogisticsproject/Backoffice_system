import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { AuthGuard } from '../../core/identity/api/auth.guard';
import { VnAdministrativeService } from './vn-administrative.service';
import type { AdministrativeUnit } from './vn-administrative.client';

/**
 * The two dropdowns on the location form — tỉnh/thành then phường/xã — served
 * from our own origin.
 *
 * ★ WHY THIS IS PROXIED RATHER THAN CALLED FROM THE BROWSER. The upstream does
 * send `Access-Control-Allow-Origin: *`, so a direct call would work — this is
 * not a CORS workaround. It is here because:
 *
 *   the allowance   the upstream rate-limits per IP, and an office behind one
 *                   NAT is one IP. Proxied and cached, the whole company spends
 *                   a couple of requests a day instead of a couple per dialog.
 *   the outage      one shared cache keeps every dispatcher working when the
 *                   service is down. Per-browser caches do not.
 *   the origin      this client talks to `/api` and nothing else — the same
 *                   argument `.env.production` makes for the API URL itself.
 *
 * ★ AUTHENTICATED, NOT PERMISSIONED. The data is public; the ALLOWANCE is not.
 * `AuthGuard` keeps this from becoming an open proxy that anybody can spend our
 * rate limit through. Beyond that there is nothing to gate: whoever may open
 * the location form may read the list of provinces, and a `trip.*` permission
 * here would only mean a form somebody can open with a dropdown they cannot
 * fill. No `BackofficeOnlyGuard` either — a driver has no form that asks, and
 * refusing them the name of a province protects nothing.
 */

/**
 * A unit code as the upstream issues them: `"79"` for a province, `"26734"` for
 * a ward. Digits in practice; accepted as alphanumeric so a source that codes
 * differently does not need this file changed.
 *
 * Short and alphanumeric — enough to keep anything path-shaped or query-shaped
 * out of the URL it is interpolated into. Not `UuidParam`: these are not ours
 * to shape.
 */
const unitCodeSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{1,10}$/, 'An administrative code is 1-10 letters or digits.');

@Controller()
export class VnAdministrativeController {
  constructor(private readonly units: VnAdministrativeService) {}

  /** The tỉnh/thành phố. */
  @Get('vn-provinces')
  @UseGuards(AuthGuard)
  async listProvinces(): Promise<AdministrativeUnit[]> {
    return this.units.listProvinces();
  }

  /**
   * The phường/xã of one province.
   *
   * ★ NESTED UNDER THE PROVINCE, BECAUSE THE PROVINCE IS THE PARENT. Since the
   * 2025 merger abolished quận/huyện there is nothing between the two, so the
   * path says exactly what the hierarchy is and carries no segment the server
   * would have to check for agreement.
   */
  @Get('vn-provinces/:provinceCode/wards')
  @UseGuards(AuthGuard)
  async listWards(
    @Param('provinceCode', new ZodValidationPipe(unitCodeSchema)) provinceCode: string,
  ): Promise<AdministrativeUnit[]> {
    return this.units.listWards(provinceCode);
  }
}
