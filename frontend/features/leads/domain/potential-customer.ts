import { OwnedRecord } from '@bo/types';

/**
 * Khách hàng tiềm năng — a company THG might serve.
 *
 * The status set is deliberately the operational one the business actually
 * uses, not a generic CRM pipeline (Discussion → Negotiation → Closing).
 * What matters here is whether someone owns the customer and whether they
 * converted.
 */
export type PotentialCustomerStatus = 'UNASSIGNED' | 'ASSIGNED' | 'CONVERTED' | 'CLOSED';

/** How the customer first reached THG. Reflects real sales sourcing. */
export type SourceChannel = 'FACEBOOK_GROUP' | 'FANPAGE' | 'TELEGRAM' | 'WEBSITE' | 'REFERRAL' | 'EVENT';

/** Where an assigned customer is in the onboarding sequence. */
export type OnboardingStage = 'NOT_STARTED' | 'CATALOGUE_SENT' | 'MEETING_BOOKED' | 'SALE_KIT_SENT' | 'ONBOARDED';

export interface PotentialCustomer extends OwnedRecord {
  name: string;
  /** THG service line the customer is interested in. */
  businessLine: string;
  status: PotentialCustomerStatus;
  source: SourceChannel;
  onboarding: OnboardingStage;
  contact: string;
  createdAt: string;
  /** Last time anyone actually talked to them. Drives the "needs attention" list. */
  lastContactedAt: string | null;
  /** When the owner promised to follow up. */
  followUpAt: string | null;
  note?: string;
}

/** Workload figure per team member, used by the head's assignment view. */
export interface TeamWorkload {
  userId: string;
  name: string;
  active: number;
  converted: number;
}
