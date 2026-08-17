import { BadgeTone } from '@bo/components';
import { OnboardingStage, PotentialCustomerStatus, SourceChannel } from '../domain/potential-customer';

/** Business vocabulary lives with the capability, never in the design system. */

export const STATUS: Record<PotentialCustomerStatus, { label: string; tone: BadgeTone }> = {
  UNASSIGNED: { label: 'Chưa phân công', tone: 'warning' },
  ASSIGNED: { label: 'Đã phân công', tone: 'info' },
  CONVERTED: { label: 'Đã chuyển đổi', tone: 'success' },
  CLOSED: { label: 'Đã đóng', tone: 'neutral' },
};

export const SOURCE: Record<SourceChannel, { label: string; icon: string }> = {
  FACEBOOK_GROUP: { label: 'Group Facebook', icon: 'users' },
  FANPAGE: { label: 'Fanpage', icon: 'flag' },
  TELEGRAM: { label: 'Telegram', icon: 'message-circle' },
  WEBSITE: { label: 'Website', icon: 'link' },
  REFERRAL: { label: 'Giới thiệu', icon: 'share' },
  EVENT: { label: 'Sự kiện', icon: 'calendar' },
};

export const ONBOARDING: Record<OnboardingStage, { label: string; step: number }> = {
  NOT_STARTED: { label: 'Chưa bắt đầu', step: 0 },
  CATALOGUE_SENT: { label: 'Đã gửi catalogue', step: 1 },
  MEETING_BOOKED: { label: 'Đã hẹn meeting', step: 2 },
  SALE_KIT_SENT: { label: 'Đã gửi Sale Kit', step: 3 },
  ONBOARDED: { label: 'Đã onboard', step: 4 },
};

export const ONBOARDING_STEPS = 4;

/** A customer untouched for a week is going cold. */
const STALE_DAYS = 7;

export function isStale(customer: { lastContactedAt: string | null; status: string }): boolean {
  if (customer.status !== 'ASSIGNED') return false;
  if (!customer.lastContactedAt) return true;
  return Date.now() - new Date(customer.lastContactedAt).getTime() > STALE_DAYS * 86_400_000;
}

export function isFollowUpDue(customer: { followUpAt: string | null; status: string }): boolean {
  if (customer.status !== 'ASSIGNED' || !customer.followUpAt) return false;
  return new Date(customer.followUpAt).getTime() <= Date.now() + 86_400_000;
}
