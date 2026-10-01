-- Fixtures for the bo-prod-ops end-to-end test: one legacy `confirmed` trip per
-- classification, plus trips the audit must never list. Every free-text, money
-- and personal column carries a PII-SENTINEL value; the test asserts none of
-- them ever reaches bo-prod-ops output. Ids are psql variables (pre-quoted),
-- each written once.
\set ON_ERROR_STOP on
\set boss '''00000000-0000-4000-8000-0000000000b0'''
\set driver '''00000000-0000-4000-8000-0000000000d0'''
\set customer '''00000000-0000-4000-8000-0000000000c0'''
\set lorry1 '''00000000-0000-4000-8000-0000000000e1'''
\set lorry3 '''00000000-0000-4000-8000-0000000000e3'''
\set a1 '''a0000000-0000-4000-8000-000000000001'''
\set a2 '''a0000000-0000-4000-8000-000000000002'''
\set a3 '''a0000000-0000-4000-8000-000000000003'''
\set a4 '''a0000000-0000-4000-8000-000000000004'''
\set a5 '''a0000000-0000-4000-8000-000000000005'''
\set a6 '''a0000000-0000-4000-8000-000000000006'''
\set a7 '''a0000000-0000-4000-8000-000000000007'''
\set turn1 '''b0000000-0000-4000-8000-000000000001'''
\set turn3 '''b0000000-0000-4000-8000-000000000003'''

INSERT INTO users (id, display_name, account_type) VALUES
  (:boss, 'PII-SENTINEL-OPERATOR-NAME', 'employee'),
  (:driver, 'PII-SENTINEL-DRIVER-NAME', 'driver');
INSERT INTO trip_customers (id, name, created_by) VALUES (:customer, 'PII-SENTINEL-CUSTOMER', :boss);
INSERT INTO trip_vehicles (id, plate, created_by) VALUES
  (:lorry1, 'PII-SENTINEL-PLATE-1', :boss),
  (:lorry3, 'PII-SENTINEL-PLATE-3', :boss);

-- Every trip starts as legacy `confirmed`; a6 and a7 are moved off it below.
INSERT INTO trip_schedules (id, scheduled_on, customer_id, status, created_by, cargo_info, note,
                            pickup_address, delivery_address, pickup_contact, delivery_contact,
                            sell_price, purchase_price, pickup_at, delivery_at)
SELECT v.id::uuid, v.day::date, :customer, 'confirmed', :boss, 'PII-SENTINEL-CARGO', 'PII-SENTINEL-NOTE',
       'PII-SENTINEL-PICKUP-ADDRESS', 'PII-SENTINEL-DELIVERY-ADDRESS', 'PII-SENTINEL-PHONE-0909000111',
       'PII-SENTINEL-PHONE-0909000222', 7777777, 6666666, v.pickup::timestamptz, v.delivery::timestamptz
  FROM (VALUES
    (:a1, '2026-08-10', '2026-08-09 10:00+07', '2026-08-10 15:00+07'),  -- ELIGIBLE, no stamp, crewed; pickup on another day
    (:a2, '2026-08-11', NULL, NULL),                                    -- ELIGIBLE, stamp complete
    (:a3, '2026-08-12', NULL, NULL),                                    -- CONFLICT_PENDING_COMPLETION
    (:a4, '2026-08-13', NULL, NULL),                                    -- SKIPPED_ARCHIVED
    (:a5, '2026-08-14', '2026-08-14 11:00+07', '2026-08-14 09:00+07'),  -- ELIGIBLE, delivery not after pickup
    (:a6, '2026-08-15', NULL, NULL),                                    -- pending: never listed
    (:a7, '2026-08-16', NULL, NULL)                                     -- finished: never listed
  ) AS v (id, day, pickup, delivery);
UPDATE trip_schedules SET status = 'pending' WHERE id = :a6;
UPDATE trip_schedules SET status = 'finished' WHERE id = :a7;
UPDATE trip_schedules SET closed_at = '2026-08-11 18:00+07', closed_by = :boss WHERE id IN (:a2, :a7);
UPDATE trip_schedules SET archived_at = now(), archived_by = :boss WHERE id = :a4;

INSERT INTO trip_driver_assignments (id, trip_id, vehicle_id, driver_user_id, assigned_by) VALUES
  (:turn1, :a1, :lorry1, :driver, :boss),
  (:turn3, :a3, :lorry3, :driver, :boss);
UPDATE trip_driver_assignments SET state = 'ended', ended_by = :boss, ended_at = now(), end_reason = 'PII-SENTINEL-END-REASON'
 WHERE id = :turn1;
INSERT INTO trip_completion_requests (trip_id, driver_assignment_id, attempt_no, expense_declaration, submitted_by) VALUES
  (:a3, :turn3, 1, 'none', :driver);
INSERT INTO trip_costs (trip_id, category, amount, created_by, note) VALUES
  (:a1, 'fuel', 5555555, :boss, 'PII-SENTINEL-COST-NOTE');
