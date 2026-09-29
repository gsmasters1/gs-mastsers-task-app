alter table public.bid_message_alerts
  add column if not exists push_sent_at timestamptz;

alter table public.office_message_alerts
  add column if not exists push_sent_at timestamptz;

create index if not exists bid_message_alerts_push_queue_idx
  on public.bid_message_alerts (created_at)
  where status = 'pending' and push_sent_at is null;

create index if not exists office_message_alerts_push_queue_idx
  on public.office_message_alerts (updated_at)
  where status in ('pending', 'bypassed') and push_sent_at is null;
