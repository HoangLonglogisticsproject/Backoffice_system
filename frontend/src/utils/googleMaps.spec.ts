import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePlace, searchPlaces } from './googleMaps';

/**
 * The adapter against a stand-in for Google's SDK.
 *
 * ★ NOTHING HERE LOADS A SCRIPT. `loadGoogleMaps` returns `window.google.maps`
 * when it is already present, so the SDK is replaced with the two members the
 * adapter touches. The property this file exists to pin down: a suggestion
 * that is on screen can always be resolved, whichever earlier search happens
 * to finish after it.
 */
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const prediction = (placeId: string, name: string, lat: number, lng: number) => ({
  placeId,
  text: { text: name },
  mainText: { text: name },
  secondaryText: { text: 'Bình Dương' },
  toPlace: () => ({
    location: { lat: () => lat, lng: () => lng },
    formattedAddress: `${name}, Bình Dương`,
    fetchFields: vi.fn().mockResolvedValue(undefined),
  }),
});

type Fetched = { suggestions: { placePrediction: ReturnType<typeof prediction> | null }[] };

const fetchAutocompleteSuggestions = vi.fn<(request: Record<string, unknown>) => Promise<Fetched>>();

beforeEach(() => {
  fetchAutocompleteSuggestions.mockReset();
  window.google = {
    maps: {
      importLibrary: (async () => ({
        AutocompleteSessionToken: class {},
        AutocompleteSuggestion: { fetchAutocompleteSuggestions },
      })) as unknown as NonNullable<NonNullable<Window['google']>['maps']>['importLibrary'],
    },
  };
});

afterEach(() => {
  delete window.google;
});

describe('searchPlaces / resolvePlace', () => {
  it('★ a suggestion from the latest search still resolves after an EARLIER search finishes late', async () => {
    const a = deferred<Fetched>();
    const b = deferred<Fetched>();
    fetchAutocompleteSuggestions.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);

    const searchA = searchPlaces('Kho');
    const searchB = searchPlaces('Kho TCS');

    // B completes first and is what the screen shows.
    b.resolve({ suggestions: [{ placePrediction: prediction('p-b', 'Kho TCS', 10.9, 106.72) }] });
    const shownB = await searchB;
    expect(shownB.map((s) => s.id)).toEqual(['p-b']);

    // A completes afterwards, carrying a DIFFERENT prediction under whatever id.
    a.resolve({ suggestions: [{ placePrediction: prediction('p-a', 'Kho', 10.1, 106.1) }] });
    await searchA;

    // The visible row resolves to ITS place, untouched by A's late arrival.
    await expect(resolvePlace(shownB[0]!)).resolves.toEqual({
      address: 'Kho TCS, Bình Dương',
      latitude: 10.9,
      longitude: 106.72,
    });
  });

  it('keeps each search’s rows resolvable even when both name the same place id', async () => {
    fetchAutocompleteSuggestions
      .mockResolvedValueOnce({ suggestions: [{ placePrediction: prediction('same', 'First', 1, 1) }] })
      .mockResolvedValueOnce({ suggestions: [{ placePrediction: prediction('same', 'Second', 2, 2) }] });

    const [first] = await searchPlaces('one');
    const [second] = await searchPlaces('two');

    await expect(resolvePlace(first!)).resolves.toMatchObject({ latitude: 1, longitude: 1 });
    await expect(resolvePlace(second!)).resolves.toMatchObject({ latitude: 2, longitude: 2 });
  });

  it('exposes only id, primary and secondary on a suggestion', async () => {
    fetchAutocompleteSuggestions.mockResolvedValueOnce({
      suggestions: [{ placePrediction: prediction('p1', 'Kho TCS', 10.9, 106.72) }, { placePrediction: null }],
    });

    const rows = await searchPlaces('Kho TCS');

    expect(rows).toEqual([{ id: 'p1', primary: 'Kho TCS', secondary: 'Bình Dương' }]);
  });

  it('refuses a row it did not produce', async () => {
    await expect(resolvePlace({ id: 'x', primary: 'x', secondary: '' })).rejects.toThrow(/no longer available/);
  });
});
