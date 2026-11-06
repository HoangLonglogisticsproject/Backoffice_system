import { EXPORT_MAX_CONCURRENT, ExportBusyError } from '../domain/trip-export';
import { TripExportSlots } from './trip-export-slots';

describe('TripExportSlots', () => {
  it('★ runs two exports at once and refuses the third — refused, not queued', () => {
    const slots = new TripExportSlots();
    expect(EXPORT_MAX_CONCURRENT).toBe(2);

    slots.acquire();
    slots.acquire();

    expect(() => slots.acquire()).toThrow(ExportBusyError);
    expect(slots.inUse).toBe(2);
  });

  it('gives a slot back on release, and a second release of the same slot changes nothing', () => {
    const slots = new TripExportSlots();
    const first = slots.acquire();
    slots.acquire();

    first();
    first();

    expect(slots.inUse).toBe(1);
    expect(() => slots.acquire()).not.toThrow();
    expect(() => slots.acquire()).toThrow(ExportBusyError);
  });

  it('refuses with a retry hint the client can act on', () => {
    const slots = new TripExportSlots();
    slots.acquire();
    slots.acquire();

    try {
      slots.acquire();
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toMatchObject({ code: 'EXPORT_BUSY', retryAfterSeconds: 30 });
    }
  });
});
