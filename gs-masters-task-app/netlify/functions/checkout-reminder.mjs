// Legacy 6pm checkout sender retired: daily-reminder.mjs already handles
// checkout reminders at 5:30pm Central. Keeping this endpoint inert prevents
// duplicate SMS and accidental manual invocations.
export default async () => new Response(JSON.stringify({ retired: true, successor: "daily-reminder" }), {
  status: 200, headers: { "Content-Type": "application/json" }
});
