import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  discardDriverFuelPhoto,
  driverFuelPhotoUrl,
  fetchDriverWaitingPhotos,
  fetchMyFuelSubmission,
  fetchMyFuelSubmissions,
  resubmitFuelSubmission,
  stageDriverFuelPhoto,
} from '@/api/driverFuel';
import type { DriverReceiptInput, FuelEvidence, FuelEvidenceType, FuelReviewStatus } from '@/types/fuel';
import type { TranslationKey } from '@/types/translate';
import { isApiError } from '@/utils/errors';
import { notifyError, notifySuccess } from '@/utils/toast';
import { driverKeys } from './index';

/**
 * ★ UNDER `assignments()`: recording a fill on a turn invalidates the turn's
 * day, and the driver's fuel list moves with it.
 */
export const driverFuelKeys = {
  all: () => [...driverKeys.assignments(), 'fuel'] as const,
  list: (filter: { statuses?: FuelReviewStatus[]; day?: string }) => [...driverFuelKeys.all(), 'list', filter] as const,
  one: (id: string) => [...driverFuelKeys.all(), 'one', id] as const,
  waiting: () => [...driverKeys.all, 'fuel-photos'] as const,
};

export function useMyFuelSubmissions(filter: { statuses?: FuelReviewStatus[]; day?: string }) {
  return useQuery({ queryKey: driverFuelKeys.list(filter), queryFn: () => fetchMyFuelSubmissions(filter), staleTime: 30_000 });
}

export function useMyFuelSubmission(id: string | null) {
  return useQuery({
    queryKey: driverFuelKeys.one(id ?? ''),
    queryFn: () => fetchMyFuelSubmission(id as string),
    enabled: id !== null,
  });
}

/** Answers "Cần bổ sung" and sends the fill back for checking. */
export function useResubmitFuel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: DriverReceiptInput & { note?: string } }) => resubmitFuelSubmission(id, input),
    onSuccess: () => {
      notifySuccess('toastFuelResubmitted');
      return client.invalidateQueries({ queryKey: driverKeys.all });
    },
  });
}

/** A photo of this fill: what it shows, and a preview the phone can draw. */
export interface FuelPhoto {
  evidence: FuelEvidence;
  type: FuelEvidenceType | null;
  previewUrl: string;
}

/** Why a photo was refused, in the driver's words — never the server's sentence. */
export function photoErrorKey(error: unknown): TranslationKey {
  if (!isApiError(error)) return 'driverErrNetwork';
  if (error.status === 503) return 'driverPhotoStoreDown';
  if (error.status === 413) return 'driverPhotoTooLarge';
  const code = error.details?.['file'];
  if (code === 'HEIC_NOT_SUPPORTED') return 'driverPhotoHeic';
  if (code === 'FILE_TOO_LARGE') return 'driverPhotoTooLarge';
  if (code === 'TOO_MANY_STAGED') return 'driverPhotoTooMany';
  if (code) return 'driverPhotoUnsupported';
  return error.status === 0 ? 'driverErrNetwork' : 'driverErrUnknown';
}

/**
 * The photos of one fill being recorded, staged as they are taken.
 *
 * ★ THE SERVER REMEMBERS THEM, NOT THE PHONE. A photo taken and never sent —
 * the app closed, the signal dropped, the form abandoned — stays waiting on
 * the server and comes back as a `leftover`: used for this fill or removed by
 * the driver, never sent on its own. Nothing is discarded behind their back.
 */
export function useFuelPhotos() {
  const client = useQueryClient();
  const [tray, setTray] = useState<FuelPhoto[]>([]);
  const waiting = useQuery({ queryKey: driverFuelKeys.waiting(), queryFn: fetchDriverWaitingPhotos, staleTime: 0 });
  const inTray = new Set(tray.map((photo) => photo.evidence.id));
  const leftovers = (waiting.data ?? []).filter((evidence) => !inTray.has(evidence.id));
  const toTray = (photo: FuelPhoto) =>
    setTray((current) => (current.some((other) => other.evidence.id === photo.evidence.id) ? current : [...current, photo]));
  const refreshWaiting = () => client.invalidateQueries({ queryKey: driverFuelKeys.waiting() });

  const add = useMutation({
    mutationFn: ({ file }: { file: File; type: FuelEvidenceType | null }) => stageDriverFuelPhoto(file),
    onSuccess: (evidence, { file, type }) => toTray({ evidence, type, previewUrl: URL.createObjectURL(file) }),
    onError: (error) => {
      notifyError(photoErrorKey(error));
      return refreshWaiting();
    },
  });

  const discard = useMutation({
    mutationFn: (evidence: FuelEvidence) => discardDriverFuelPhoto(evidence.id),
    onSuccess: (_done, evidence) => {
      setTray((current) => current.filter((photo) => photo.evidence.id !== evidence.id));
      return refreshWaiting();
    },
    onError: () => notifyError('driverPhotoRemoveFailed'),
  });

  return {
    tray,
    leftovers,
    uploading: add.isPending,
    add: (file: File, type: FuelEvidenceType | null) => add.mutate({ file, type }),
    reuse: (evidence: FuelEvidence) => toTray({ evidence, type: evidence.evidenceType, previewUrl: driverFuelPhotoUrl(evidence.id) }),
    remove: (evidence: FuelEvidence) => discard.mutate(evidence),
    /** What the fill carries: each photo with what it shows. */
    evidence: (): NonNullable<DriverReceiptInput['evidence']> =>
      tray.map((photo) => ({ id: photo.evidence.id, ...(photo.type ? { type: photo.type } : {}) })),
    /** Sent with a fill that was saved: they are attached now, not waiting. */
    clear: () => {
      setTray([]);
      return refreshWaiting();
    },
  };
}

export type FuelPhotos = ReturnType<typeof useFuelPhotos>;
