-- Public bucket for barbershop logos. Files live under "<barbershop_id>/..." and only
-- members of that shop (or platform admins) can write there. Public read via URL only;
-- there is no SELECT policy, so the bucket cannot be listed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists logos_insert_member on storage.objects;
drop policy if exists logos_update_member on storage.objects;
drop policy if exists logos_delete_member on storage.objects;

create policy logos_insert_member on storage.objects
  for insert to authenticated with check (
    bucket_id = 'logos' and (
      exists (select 1 from public.barbershop_members m
              where m.user_id = (select auth.uid()) and m.barbershop_id::text = (storage.foldername(name))[1])
      or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_platform_admin)
    )
  );
create policy logos_update_member on storage.objects
  for update to authenticated using (
    bucket_id = 'logos' and (
      exists (select 1 from public.barbershop_members m
              where m.user_id = (select auth.uid()) and m.barbershop_id::text = (storage.foldername(name))[1])
      or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_platform_admin)
    )
  );
create policy logos_delete_member on storage.objects
  for delete to authenticated using (
    bucket_id = 'logos' and (
      exists (select 1 from public.barbershop_members m
              where m.user_id = (select auth.uid()) and m.barbershop_id::text = (storage.foldername(name))[1])
      or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_platform_admin)
    )
  );
