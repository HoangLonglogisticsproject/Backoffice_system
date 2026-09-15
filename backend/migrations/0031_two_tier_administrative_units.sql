-- 0031 · Vietnam's two-tier administrative units, recorded against the columns
-- ============================================================================
--
-- ★ THIS FILE CHANGES NO STRUCTURE, AND THAT IS THE POINT. The six columns
-- 0030 added are exactly the right six; what changed is which of them anything
-- still WRITES. This migration exists because the reasoning written into 0030
-- is now the opposite of what the code does, and 0030 cannot be edited — the
-- runner checksums an applied file and refuses a server whose text has drifted
-- (`migration-runner.ts`, `verifyUnchanged`). Forward-only applies to prose as
-- much as to DDL: the correction is a new file.
--
-- ★ WHAT 0030 DECIDED, AND WHY IT NO LONGER HOLDS. 0030 chose the PRE-reform
-- hierarchy on purpose — 63 provinces → quận/huyện → old wards — reading
-- `provinces.open-api.vn/api/v1`, on the argument that dispatchers and customer
-- contracts still say "Quận 7" and "Bình Dương", and that the old hierarchy at
-- least agreed with itself.
--
-- That argument had a shelf life and it has expired. Every party to those
-- contracts has since re-papered onto the 34 tỉnh/thành; a list offering "Tỉnh
-- Bình Dương" now sends somebody looking for a province nobody issues any more,
-- and the wards on offer were the pre-merger ones, which is a list of places
-- that no longer exist. `VN_ADMIN_API_URL` now points at `…/api/v2`, the form
-- offers tỉnh/thành → phường/xã, and there is no third control.
--
-- ★ NO BACKFILL, AND NO ATTEMPT AT ONE. The obvious-looking migration — map
-- every old ward onto its merged successor — is not written here because it
-- cannot be written correctly: the 2025 merger is not one-to-one, several old
-- wards fold into one new one and some split, and this schema has no evidence
-- for which. Guessing would replace a label a person recognises with a label
-- that is confidently wrong. These fields are DESCRIPTIVE — a trip snapshots
-- its own `address` (0022), the geofence measures coordinates (0019), nothing
-- operational reads them — so a stale one costs a moment's recognition, while a
-- wrong one costs a delivery.
--
-- A row migrates when a person opens it and re-picks the province. The form
-- clears the ward AND the old district in the same stroke, so no row is ever
-- left half-new — a 34-province name over a "Quận 7" would be the one state
-- that is worse than either hierarchy alone.
--
-- ★ SO `district`/`district_code` STAY, READ-ONLY. Dropping them would delete
-- the only record of where a pre-merger row was filed, from rows nobody has
-- revisited yet, to save two nullable TEXT columns. `fullAddress` still prints
-- the district for those rows and the location form shows it greyed out with
-- the reason. Nothing writes a fresh one.

-- ---------------------------------------------------------------- comments ---
-- ★ COMMENT ON, BECAUSE THE NEXT PERSON HERE MAY BE HOLDING psql RATHER THAN
-- THIS REPOSITORY. `\d+ trip_locations` is where somebody debugging an address
-- actually looks, and until now it said nothing about which hierarchy the text
-- in these columns belongs to. Re-running replaces the comment rather than
-- failing, so this file is idempotent without a guard.

COMMENT ON COLUMN trip_locations.province_code IS
  'Post-2025 tỉnh/thành code (34 units), from provinces.open-api.vn/api/v2. Descriptive only; NULL = not recorded. Rows written before 1 July 2025 may hold a pre-merger code.';

COMMENT ON COLUMN trip_locations.province IS
  'Tỉnh/thành name as it stood when the row was saved. The code identifies; this is the label, stored so a list reads without an API call.';

COMMENT ON COLUMN trip_locations.district_code IS
  'ABOLISHED TIER — quận/huyện ceased to exist on 1 July 2025. Read-only legacy: nothing writes this any more. Cleared when a person re-picks the province on the location form.';

COMMENT ON COLUMN trip_locations.district IS
  'ABOLISHED TIER — see district_code. Still rendered in the joined address of pre-merger rows, because it is how somebody recognises that place.';

COMMENT ON COLUMN trip_locations.ward_code IS
  'Phường/xã code, hanging directly off the PROVINCE since the 2025 merger. NOT UNIQUE in the upstream feed — codes have been observed carrying different names — so a ward is identified by code AND name together, never by code alone.';

COMMENT ON COLUMN trip_locations.ward IS
  'Phường/xã name. Half of the ward identity, not decoration; see ward_code.';
