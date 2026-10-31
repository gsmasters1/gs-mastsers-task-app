# Phase 3 — Field Operations acceptance checklist

This change is in the **crew field app repository** (the UI embedded from GSM Builder).
It does not change bank integration, billing approval, or the accounting reminders.

## Automated checks

- `src/checkinSave.test.js`: confirmed write, network queued, permission/validation/server rejection not queued, bilingual permission messages.
- `netlify/functions/field-reminder-dedupe.test.mjs`: a crew member with two open jobs receives one evening reminder.
- `CI=false npm run build`: ensure full React bundle compiles. The CI workflow also runs the two tests above.

## Live acceptance (required before calling it operational)

- [ ] Verify a real **Alberto** profile is active, has an associated Supabase Auth user/session, and can INSERT/SELECT his own `field_checkins` under current row-level security. Do not request or store his PIN in chat or a ticket.
- [ ] Alberto signs in on his usual device and clocks in and out at an actual job location. Check the server row, not only the green UI.
- [ ] Alex repeats on his own device; check-in must not require an assigned task.
- [ ] On a job with zero tasks, crew checks in, records a free-text description of work, and checks out. Office sees the log attached to the correct job.
- [ ] With network disabled, check-in shows **Pending sync**, and the queued action saves once after reconnecting. A server 401/403 must show **NOT checked in** and must never enter the offline queue.
- [ ] With a check-in left open from yesterday, opening the app asks for the **actual checkout date/time**; no fabricated auto-close is entered. QR clock-in must direct the user to correct the stale shift first.
- [ ] Verify the **5:30 PM Central** daily reminder sends at most one checkout SMS per crew member; the old 6 PM sender has no schedule. Confirm morning 7 AM Central Mon–Sat check-in reminders still work. Test with opted-in office test numbers before relying on live texts.
- [ ] Confirm `SUPABASE_SERVICE_KEY`, Twilio secrets and Netlify scheduled functions are configured server-side, RLS policies are correct, and SMS logs do not expose PINs or credentials.
- [ ] Confirm employee full names in the office roster and check-in reports; distinguish identical first names by profile ID and phone.
- [ ] Verify separate crew, supervisor and admin views; crew must not receive accounting or admin-only controls.

### Known limits

The client change makes a permission denial visible; it **cannot repair a missing Alberto Auth identity or Supabase RLS policy** by itself. Exact cause needs a real authenticated test and the corresponding Supabase response/row. SMS scheduling, genuine GPS behavior and offline replay require device testing. Until those are done, code can be merged after CI but should not be described as production-verified.
