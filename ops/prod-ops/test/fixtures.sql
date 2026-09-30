-- Fixtures for the bo-prod-ops end-to-end test: one legacy `confirmed` trip per
-- classification, plus trips the audit must never list. Every free-text, money
-- and personal column carries a PII-SENTINEL value; the test asserts none of
-- them ever reaches bo-prod-ops output.
\set ON_ERROR_STOP on
\set boss '''00000000-0000-4000-8000-0000000000b0'''
\set driver '''00000000-0000-4000-8000-0000000000d0'''
\set customer '''00000000-0000-4000-8000-0000000000c0'''

INSERT INTO users (id, display_name, account_type) VALUES
  (:boss, 'PII-SENTINEL-OPERATOR-NAME', 'employee'),
  (:driver, 'PII-SENTINEL-DRIVER-NAME', 'driver');
INSERT INTO trip_customers (id, name, created_by) VALUES (:customer, 'PII-SENTINEL-CUSTOMER', :boss);
INSERT INTO trip_vehicles (id, plate, created_by) VALUES
  ('00000000-0000-4000-8000-0000000000e1', 'PII-SENTINEL-PLATE-1', :boss),
  ('00000000-0000-4000-8000-0000000000e3', 'PII-SENTINEL-PLATE-3', :boss);

INSERT INTO trip_schedules (id, scheduled_on, customer_id, status, created_by, cargo_info, note,
                            pickup_address, delivery_address, pickup_contact, delivery_contact,
                            sell_price, purchase_price, pickup_at, delivery_at)
SELECT v.id::uuid, v.day::date, :customer, v.status, :boss, 'PII-SENTINEL-CARGO', 'PII-SENTINEL-NOTE',
       'PII-SENTINEL-PICKUP-ADDRESS', 'PII-SENTINEL-DELIVERY-ADDRESS', 'PII-SENTINEL-PHONE-0909000111',
       'PII-SENTINEL-PHONE-0909000222', 7777777, 6666666, v.pickup::timestamptz, v.delivery::timestamptz
  FROM (VALUES
    -- a1 ELIGIBLE, no closing stamp, crewed; its pickup falls on another day
    ('a0000000-0000-4000-8000-000000000001', '2026-08-10', 'confirmed', '2026-08-09 10:00+07', '2026-08-10 15:00+07'),
    -- a2 ELIGIBLE, closing stamp complete
    ('a0000000-0000-4000-8000-000000000002', '2026-08-11', 'confirmed', NULL, NULL),
    -- a3 CONFLICT_PENDING_COMPLETION: a driver request is waiting
    ('a0000000-0000-4000-8000-000000000003', '2026-08-12', 'confirmed', NULL, NULL),
    -- a4 SKIPPED_ARCHIVED
    ('a0000000-0000-4000-8000-000000000004', '2026-08-13', 'confirmed', NULL, NULL),
    -- a5 ELIGIBLE, delivery not after pickup
    ('a0000000-0000-4000-8000-000000000005', '2026-08-14', 'confirmed', '2026-08-14 11:00+07', '2026-08-14 09:00+07'),
    -- never listed: not legacy
    ('a0000000-0000-4000-8000-000000000006', '2026-08-15', 'pending', NULL, NULL),
    ('a0000000-0000-4000-8000-000000000007', '2026-08-16', 'finished', NULL, NULL)
  ) AS v (id, day, status, pickup, delivery);

UPDATE trip_schedules SET closed_at = '2026-08-11 18:00+07', closed_by = :boss
 WHERE id IN ('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000007');
UPDATE trip_schedules SET archived_at = now(), archived_by = :boss WHERE id = 'a0000000-0000-4000-8000-000000000004';

INSERT INTO trip_driver_assignments (id, trip_id, vehicle_id, driver_user_id, assigned_by) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000e1', :driver, :boss),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000e3', :driver, :boss);
UPDATE trip_driver_assignments SET state = 'ended', ended_by = :boss, ended_at = now(), end_reason = 'PII-SENTINEL-END-REASON'
 WHERE id = 'b0000000-0000-4000-8000-000000000001';
INSERT INTO trip_completion_requests (trip_id, driver_assignment_id, attempt_no, expense_declaration, submitted_by) VALUES
  ('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', 1, 'none', :driver);
INSERT INTO trip_costs (trip_id, category, amount, created_by, note) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'fuel', 5555555, :boss, 'PII-SENTINEL-COST-NOTE');
