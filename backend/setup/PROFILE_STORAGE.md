# Profile storage unavailable: deployment fix

Live read-only diagnosis on 2026-11-22 found the auth user table and one account,
but no `wp_employee_profiles`, `wp_departments` or `wp_core_employees` resources.
`wp_auth_users.deleted_at` is also absent. Calling the read-only `get` and
`preferences` actions returns PGRST202: `wp_core_profile` is missing from the
schema cache. Thus authentication works while profile persistence cannot work.
The earlier HEAD-based check incorrectly treated an empty 204 response as proof
that a table existed. The new check uses zero-row GETs and explicit RPC checks.

## Review and deploy the existing canonical migration

1. In the same Supabase project used by backend/.env, open SQL Editor → New Query.
2. Run `setup/profile-preflight.sql` first (read-only). It lists only objects added
   by proposal 002. If anything is present, review partial/existing deployment
   before applying; do not drop objects or rerun CREATE blindly.
3. Review `migrations/002_core_management.proposed.sql`, then run the **entire
   file** from BEGIN through COMMIT after approval. Migration 001 is already
   present: **do not rerun 001 or bootstrap your Admin again**.
4. Migration 002 adds the required columns, four management tables, scoped view,
   profile RPC/authorization functions, grants and RLS. It backfills one blank
   profile for each existing account, including the Admin, and creates profiles
   for future accounts via a trigger. Existing passwords, email and Admin role
   are retained. It does not insert sample people or overwrite personal data.
   This uses the existing reviewed migration instead of inventing an incompatible
   second profile schema; its scope includes department/consent dependencies.
5. If the function still reports a schema-cache miss after successful deployment,
   reload PostgREST's schema cache using SQL Editor:

   ```sql
   NOTIFY pgrst, 'reload schema';
   ```

6. In backend, run `npm run check:profile`. It must print `ready: true` before
   trying the UI again. The RPC's expected PT403 check is intentional: a null
   actor must be denied; the checker does not read or change an account.
7. Return to My Profile and click Retry loading profile. An existing valid login
   can be reused; sign in again if it has expired. Enter personal details and
   Save Changes. Operational APIs from later phases require their own approved
   migrations; deploying 002 does not deploy 003–007.

No live SQL was applied while diagnosing this issue. No passwords or personal
records were printed or changed. Backend/client error responses remain safe;
schema details are exposed only by this trusted local operator check.
