import { API_BASE_URL, httpClient } from './client';
import type { DriverFuelSubmission, DriverFuelSubmissionDetail, DriverReceiptInput, FuelEvidence, FuelReviewStatus } from '@/types/fuel';

/**
 * The driver's own fuel (0038): their photos and their fills' review. ★ NOT
 * the office's `/fuel-evidence` — a driver holds no `cost.import`; these are
 * the driver's door, scoped by the session on the server.
 *
 * The fill itself is recorded on the turn (`recordFuelFill`, `declareDailyFuel`),
 * where the server names the lorry and the day.
 */

/** Stages one photo of the fill. ★ multipart: the JSON default would serialise the form. */
export async function stageDriverFuelPhoto(file: File): Promise<FuelEvidence> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await httpClient.post<FuelEvidence>('/driver/fuel-evidence', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

/** Every photo the driver uploaded that still waits — a closed app or a lost signal strands none. */
export async function fetchDriverWaitingPhotos(): Promise<FuelEvidence[]> {
  const { data } = await httpClient.get<FuelEvidence[]>('/driver/fuel-evidence/staged');
  return data;
}

export async function discardDriverFuelPhoto(id: string): Promise<void> {
  await httpClient.post(`/driver/fuel-evidence/${encodeURIComponent(id)}/discard`);
}

/** A photo the driver sent, for an `<img>` — their own only; the session authorises it. */
export const driverFuelPhotoUrl = (id: string): string =>
  `${API_BASE_URL}/driver/fuel-evidence/${encodeURIComponent(id)}/content`;

export async function fetchMyFuelSubmissions(filter: { statuses?: FuelReviewStatus[]; day?: string }): Promise<DriverFuelSubmission[]> {
  const { data } = await httpClient.get<DriverFuelSubmission[]>('/driver/fuel-submissions', {
    params: {
      ...(filter.statuses?.length ? { status: filter.statuses.join(',') } : {}),
      ...(filter.day ? { day: filter.day } : {}),
    },
  });
  return data;
}

export async function fetchMyFuelSubmission(id: string): Promise<DriverFuelSubmissionDetail> {
  const { data } = await httpClient.get<DriverFuelSubmissionDetail>(`/driver/fuel-submissions/${encodeURIComponent(id)}`);
  return data;
}

/** Answers "Cần bổ sung": what was missing, the driver's new photos, a word — and back to checking. */
export async function resubmitFuelSubmission(
  id: string,
  input: DriverReceiptInput & { note?: string },
): Promise<DriverFuelSubmissionDetail> {
  const { data } = await httpClient.post<DriverFuelSubmissionDetail>(
    `/driver/fuel-submissions/${encodeURIComponent(id)}/resubmit`,
    input,
  );
  return data;
}
