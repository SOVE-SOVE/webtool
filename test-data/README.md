# Revenue TEST dataset (Default Workspace)

Seed id: `TEST-SEED-REVENUE-2026-10`, created 2026-10-01 (workspace today, Australia/Brisbane).

- `revenue_test_seed.py`: the seed, run once from `apps/api` with
  `.venv/bin/python ../../test-data/revenue_test_seed.py`. It refuses to run again.
- `revenue-test-seed.manifest.json`: the exact IDs of every row created.
  - Top-level lists: workspace, businesses, clients, projects, website agreements, hosting plans, hosting charges, payments, checklist items and activity-log entries.
  - `dependents_by_fk`: every other row that pointed at the test businesses, clients or projects when it was seeded.

The five clients are named "TEST — …", with `test+…@example.com` billing emails and `*.example.com` sites. Payments carry the seed id in `reference`/`notes`.
**Never delete by name alone.** Always use the manifest IDs.

## Removing the dataset ("remove the test clients")

Run every step against the manifest IDs, in one transaction, after a dry-run count.

1. **Check for later real links first.** If any of these returns rows, stop and ask:
   - payments allocated to a manifest website agreement or hosting charge, or to a charge of a manifest hosting plan, whose id is NOT in `payments`;
   - rows in other tables referencing a manifest business, client or project that aren't in `dependents_by_fk`. For example, a real task, meeting or website added to a TEST project later.
2. **Charges added since seeding.** Hosting charges generated later by the hosting-billing sweep belong to manifest hosting plans. They are removed with those plans (`ON DELETE CASCADE`); list them in the dry run.
3. **Delete in this order:**
   1. `activity_log` rows: the manifest ids, plus any rows whose `entity_id` is a manifest or later-generated id.
   2. `payments` (manifest ids).
   3. `hosting_charges` (by manifest `hosting_plan_id`).
   4. `hosting_plans`.
   5. `website_agreements`.
   6. `client_checklist_items`.
   7. `projects`.
   8. `clients`.
   9. `businesses`.

   Every id must come from the manifest, or be a charge of a manifest plan.
4. **Verify.** No "TEST —" businesses remain. Real payment, plan and client counts and totals match the pre-seed baseline: 8 non-voided payments totalling $5,119.00 net, 7 hosting plans and 17 clients, unless real records were added since.
5. **Tidy up.** Move the manifest aside; don't delete it until removal is verified.

No schema change, button or UI is involved.
