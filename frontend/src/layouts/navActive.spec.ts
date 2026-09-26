import { describe, expect, it } from 'vitest';
import { isNavActive } from './navActive';

const SCHEDULE = { to: '/driver', exact: true, activePaths: ['/driver/assignments'] };
const NOTIFICATIONS = { to: '/driver/notifications' };

describe('isNavActive', () => {
  it.each([
    ['/driver', SCHEDULE, true],
    // ★ The exact home must not stay lit under every sibling destination.
    ['/driver/notifications', SCHEDULE, false],
    // ★ A trip's detail is still "on the schedule" — the tab stays lit while the driver works it.
    ['/driver/assignments/a1', SCHEDULE, true],
    ['/driver/assignments', SCHEDULE, true],
    ['/driverx', { to: '/driver' }, false],
    ['/driver/assignmentsX', SCHEDULE, false],
    ['/driver/notifications', NOTIFICATIONS, true],
    ['/driver/notifications/x', NOTIFICATIONS, true],
    // ★ A string prefix is not a path segment.
    ['/driver/notificationsX', NOTIFICATIONS, false],
    ['/driver', NOTIFICATIONS, false],
  ])('%s against %o is %s', (pathname, destination, active) => {
    expect(isNavActive(pathname, destination)).toBe(active);
  });
});
