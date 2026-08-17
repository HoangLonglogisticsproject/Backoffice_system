import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AccessService } from './access.service';
import { canAssignRecords, canSeeRecord } from './rules/record-access';
import { CapabilityDescriptor, provideCapabilities } from '../composition/capability.model';
import { Department, UserContext } from '@bo/types';
import { DepartmentRepository } from '../../store/organization/department.repository';
import { OrgStore } from '../../store/organization/org.store';
import { SessionRepository } from '../../store/session/session.repository';
import { SessionStore } from '../../store/session/session.store';

const dept = (id: string, capabilities: string[]): Department => ({
  id,
  slug: id,
  name: id,
  description: '',
  icon: 'building',
  accent: 'slate',
  active: true,
  headId: null,
  memberCount: 1,
  capabilities,
});

const SALES = dept('sales', ['customers', 'assignment']);
const MARKETING = dept('marketing', ['customers']);

/** 'assignment' has no MEMBER presentation — a member must never see it. */
const CAPABILITIES: CapabilityDescriptor[] = [
  {
    key: 'customers',
    title: 'Records',
    icon: 'users',
    accent: 'blue',
    presentations: {
      SUPERADMIN: { title: 'Records', load: async () => class {} },
      DEPARTMENT_HEAD: { title: 'Unit records', load: async () => class {} },
      MEMBER: { title: 'My records', load: async () => class {} },
    },
  },
  {
    key: 'assignment',
    title: 'Assignment',
    icon: 'user-plus',
    accent: 'teal',
    presentations: {
      SUPERADMIN: { title: 'Assignment', load: async () => class {} },
      DEPARTMENT_HEAD: { title: 'Assignment', load: async () => class {} },
    },
  },
];

async function setup(user: UserContext) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideCapabilities(CAPABILITIES),
      {
        provide: DepartmentRepository,
        useValue: { list: () => of([SALES, MARKETING]), members: () => of([]) },
      },
      {
        provide: SessionRepository,
        useValue: { current: () => of(user), personas: () => of([]), switchPersona: () => of(user) },
      },
    ],
  });
  await TestBed.inject(SessionStore).load();
  await TestBed.inject(OrgStore).load();
  return TestBed.inject(AccessService);
}

const CEO: UserContext = { userId: 'ceo', name: 'CEO', title: '', role: 'SUPERADMIN' };
const HEAD_SALES: UserContext = {
  userId: 'head-sales',
  name: 'Head Sales',
  title: '',
  role: 'DEPARTMENT_HEAD',
  departmentId: 'sales',
};
const SALES_A: UserContext = {
  userId: 'sales-a',
  name: 'Sales A',
  title: '',
  role: 'MEMBER',
  departmentId: 'sales',
};

describe('Level 1 — department isolation', () => {
  it('gives a superadmin every department', async () => {
    const access = await setup(CEO);
    expect(access.visibleDepartments().map((d) => d.id)).toEqual(['sales', 'marketing']);
  });

  it('confines a head to their own department', async () => {
    const access = await setup(HEAD_SALES);
    expect(access.visibleDepartments().map((d) => d.id)).toEqual(['sales']);
    expect(access.canViewDepartment('marketing')).toBe(false);
  });

  it('confines a member to their own department', async () => {
    const access = await setup(SALES_A);
    expect(access.canViewDepartment('sales')).toBe(true);
    expect(access.canViewDepartment('marketing')).toBe(false);
  });
});

describe('Capability presentation per persona', () => {
  it('hides a capability that has no presentation for the persona', async () => {
    const head = await setup(HEAD_SALES);
    expect(head.capabilitiesFor(SALES).map((c) => c.key)).toEqual(['customers', 'assignment']);

    const member = await setup(SALES_A);
    expect(member.capabilitiesFor(SALES).map((c) => c.key)).toEqual(['customers']);
    expect(member.canUseCapability(SALES, 'assignment')).toBe(false);
  });

  it('titles the same capability differently per persona', async () => {
    const head = await setup(HEAD_SALES);
    expect(head.presentationFor('customers')?.title).toBe('Unit records');

    const member = await setup(SALES_A);
    expect(member.presentationFor('customers')?.title).toBe('My records');
  });

  it('returns nothing for a department the persona cannot enter', async () => {
    const head = await setup(HEAD_SALES);
    expect(head.capabilitiesFor(MARKETING)).toEqual([]);
  });
});

describe('Level 2 — record ownership', () => {
  const abc = { id: 'abc', departmentId: 'sales', assigneeId: 'sales-a' };
  const xyz = { id: 'xyz', departmentId: 'sales', assigneeId: 'sales-b' };
  const unassigned = { id: 'new', departmentId: 'sales', assigneeId: null };

  it('lets a member see only their own records', () => {
    expect(canSeeRecord(abc, SALES_A)).toBe(true);
    expect(canSeeRecord(xyz, SALES_A)).toBe(false);
    expect(canSeeRecord(unassigned, SALES_A)).toBe(false);
  });

  it('lets a head see every record of their department', () => {
    expect(canSeeRecord(abc, HEAD_SALES)).toBe(true);
    expect(canSeeRecord(xyz, HEAD_SALES)).toBe(true);
    expect(canSeeRecord(unassigned, HEAD_SALES)).toBe(true);
  });

  it('does not let a head reach another department', () => {
    expect(canSeeRecord({ ...abc, departmentId: 'marketing' }, HEAD_SALES)).toBe(false);
  });

  it('lets a superadmin see everything', () => {
    expect(canSeeRecord(xyz, CEO)).toBe(true);
    expect(canSeeRecord({ ...abc, departmentId: 'marketing' }, CEO)).toBe(true);
  });

  it('restricts assignment to head and above', () => {
    expect(canAssignRecords(CEO)).toBe(true);
    expect(canAssignRecords(HEAD_SALES)).toBe(true);
    expect(canAssignRecords(SALES_A)).toBe(false);
  });
});
