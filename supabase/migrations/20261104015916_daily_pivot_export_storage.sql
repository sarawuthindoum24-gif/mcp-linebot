-- Daily files are private; only the server-side service role can upload and
-- create short-lived download links for Teams recipients.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('whservice-daily-reports', 'whservice-daily-reports', false, 10485760,
        array['text/csv'])
on conflict (id) do nothing;
