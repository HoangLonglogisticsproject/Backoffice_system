import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  attachFuelReceipt,
  discardFuelEvidence,
  fetchStagedFuelEvidence,
  findFuelMatches,
  fuelEvidenceContentUrl,
  stageFuelEvidence,
  type FuelAttachment,
} from '@/api/fuelEvidence';
import { useSession } from '@/contexts/SessionProvider';
import type { FuelCandidate, FuelEvidence, FuelReceiptQuery } from '@/types/fuel';
import type { TranslationKey } from '@/types/translate';
import { isApiError } from '@/utils/errors';
import { notifyApiError, notifyError, notifySuccess } from '@/utils/toast';
import { tripKeys } from './keys';

/** An uploaded image of the receipt, waiting to go onto a cost, with a local preview. */
export interface StagedImage {
  evidence: FuelEvidence;
  previewUrl: string;
}

/** What the person asked: the lorry, the receipt, and its images — frozen when "Tìm" is pressed. */
export interface FuelSearch {
  vehicleId: string;
  receipt: FuelReceiptQuery;
  evidenceIds: string[];
}

const UPLOAD_ERROR: Record<string, TranslationKey> = {
  FILE_TOO_LARGE: 'fuelImageTooLarge',
  HEIC_NOT_SUPPORTED: 'fuelImageHeic',
  TOO_MANY_STAGED: 'fuelTooManyStaged',
};

/** Why an upload was refused, in this screen's words. */
export function uploadErrorKey(error: unknown): TranslationKey {
  if (!isApiError(error)) return 'fuelUploadFailed';
  if (error.status === 503) return 'fuelStorageUnavailable';
  if (error.status === 413) return 'fuelImageTooLarge';
  const code = error.details?.file;
  if (code) return UPLOAD_ERROR[code] ?? 'fuelImageUnsupported';
  return 'fuelUploadFailed';
}

/** A local preview is a blob the page made; a recovered one is the server's URL and needs no release. */
const release = (image: StagedImage) => {
  if (image.previewUrl.startsWith('blob:')) URL.revokeObjectURL(image.previewUrl);
};

/** Part of the receipt already sits on another fill the person has not confirmed as different. */
export const isOnAnotherFill = (error: unknown): boolean =>
  isApiError(error) && Object.values(error.details ?? {}).includes('ON_ANOTHER_FILL');

/**
 * "Đối soát chứng từ" — find the cost a receipt already is, and attach to it.
 *
 * ★ THE SEARCH NEVER WRITES AND THE ATTACH NEVER CREATES. A receipt goes onto
 * the one cost a person picked; with nothing found, nothing is written.
 *
 * ★ THE SERVER REMEMBERS WHAT WAITS. At most 30 images may wait per person.
 * Every visit reads the caller's waiting images back from the server, and
 * the ones not in this receipt are offered as `leftovers` — to use or to
 * discard — so a closed tab or a crash never locks anybody out. Leaving the
 * screen still tries to discard the unattached ones: a courtesy, not the
 * mechanism.
 */
export function useFuelReceipt() {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const allowed = can('cost.import');
  const [images, setImages] = useState<StagedImage[]>([]);
  const [search, setSearch] = useState<FuelSearch | null>(null);
  const waiting = useRef<StagedImage[]>([]);
  waiting.current = images;

  const waitingOnServer = useQuery({ queryKey: tripKeys.fuelStaged(), queryFn: fetchStagedFuelEvidence, enabled: allowed });
  const inTray = new Set(images.map((image) => image.evidence.id));
  const leftovers = (waitingOnServer.data ?? []).filter((evidence) => !inTray.has(evidence.id));
  const toTray = (evidence: FuelEvidence, previewUrl: string) =>
    setImages((current) => (current.some((image) => image.evidence.id === evidence.id) ? current : [...current, { evidence, previewUrl }]));
  /** A leftover is used only when a person says so — never attached on its own. */
  const reuse = (evidence: FuelEvidence) => toTray(evidence, fuelEvidenceContentUrl(evidence.id));

  const matches = useQuery({
    queryKey: tripKeys.fuelMatches(search),
    queryFn: () => findFuelMatches(search?.vehicleId ?? '', search?.receipt as FuelReceiptQuery, search?.evidenceIds ?? []),
    enabled: allowed && search !== null,
  });

  useEffect(() => {
    if (!allowed) queryClient.removeQueries({ queryKey: tripKeys.fuel() });
  }, [allowed, queryClient]);

  useEffect(
    () => () => {
      for (const image of waiting.current) {
        release(image);
        void discardFuelEvidence(image.evidence.id).catch(() => undefined);
      }
    },
    [],
  );

  const upload = useMutation({
    mutationFn: stageFuelEvidence,
    // The same bytes again are the same staged row: never listed twice.
    onSuccess: (evidence, file) => toTray(evidence, URL.createObjectURL(file)),
    onError: (error) => {
      notifyError(uploadErrorKey(error));
      // At the cap the leftovers are what to clear: read them again, this tab may not have seen them all.
      if (uploadErrorKey(error) === 'fuelTooManyStaged') void queryClient.invalidateQueries({ queryKey: tripKeys.fuelStaged() });
    },
  });

  const discard = useMutation({
    mutationFn: (evidence: FuelEvidence) => discardFuelEvidence(evidence.id),
    onSuccess: (_done, evidence) => {
      waiting.current.filter((image) => image.evidence.id === evidence.id).forEach(release);
      setImages((current) => current.filter((other) => other.evidence.id !== evidence.id));
      return queryClient.invalidateQueries({ queryKey: tripKeys.fuelStaged() });
    },
    onError: (error) => notifyApiError(error, 'fuelDiscardFailed'),
  });

  const attach = useMutation({
    mutationFn: ({ target, attachment }: { target: FuelCandidate; attachment: FuelAttachment }) =>
      attachFuelReceipt(target, attachment),
    onSuccess: (_view, { target }) => {
      notifySuccess(target.backing.ledger === 'vehicle' ? 'fuelAttachedVehicle' : 'fuelAttachedTrip');
      waiting.current.forEach(release);
      setImages([]); // attached now — no longer waiting, never discarded
      return queryClient.invalidateQueries({ queryKey: tripKeys.fuel() });
    },
    onError: (error) => {
      if (!isOnAnotherFill(error)) return notifyApiError(error, 'fuelAttachFailed');
      // Part of this receipt is on another fill the list did not show — somebody attached it since, or it
      // is an image added after the search. Read again WITH every image being sent, so it can be confirmed.
      notifyError('fuelOnAnotherFill');
      setSearch((current) => current && { ...current, evidenceIds: waiting.current.map((image) => image.evidence.id) });
      return queryClient.invalidateQueries({ queryKey: tripKeys.fuel() });
    },
  });

  return { allowed, images, leftovers, reuse, search, setSearch, matches, upload, discard, attach };
}
