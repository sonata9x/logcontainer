-- Embedded Takoyaki profile images are de-duplicated into immutable Storage
-- objects before canonical documents are written to PostgreSQL.

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'log-avatar-assets',
  'log-avatar-assets',
  true,
  5000000,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
