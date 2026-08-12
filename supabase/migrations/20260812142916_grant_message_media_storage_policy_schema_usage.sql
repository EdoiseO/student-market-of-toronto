-- Storage evaluates the INSERT policy as the authenticated caller. The policy
-- invokes private.message_media_upload_is_reserved(), so callers need schema
-- USAGE in addition to the function's existing EXECUTE grant. This does not
-- grant access to any private table or any other private function.
revoke usage on schema private from public, anon, service_role;
grant usage on schema private to authenticated;
