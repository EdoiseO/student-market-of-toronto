# Browser-bound password recovery

Recovery uses Supabase PKCE with a server-held, single-use intent bound to the requesting browser and email. The existing marketplace session is not a recovery credential. Recovery Auth tokens stay in the isolated server client's memory; they are not stored in browser cookies, localStorage or the database.

## Protocol

1. `POST /api/auth/recovery` with `action: request` requires same-origin JSON. It reserves a rate-limited intent, requests an email through an isolated SDK client and stores that request's recovery-purpose verifier. An HttpOnly cookie binds the browser. Responses do not reveal whether the account exists or has been rate-limited.
2. The email opens `/reset-password?state=<intent>&code=<PKCE code>`. GET does not redeem the code. The page removes query/fragment material from history and shows the intended email only when the browser binding matches. The code stays in memory: reloading the cleaned page requires another email, although an unused link can be reopened from the original email.
3. Submitting the new password and confirmation atomically consumes the matching, unexpired intent before exchanging the code. The verified Auth identity must match the recorded email. An ordinary browser session is never adopted as the recovery identity.
4. A successful password update triggers global refresh-session revocation. Revocation failure is reported separately; existing access JWTs may remain valid until expiry. Only an ordinary session for the recovered account is cleared. A different account stays signed in. An ambiguous update requires checking the new password or requesting another link, not replaying the consumed intent.

## Configuration and limits

- The prerequisite migration is `20260906150000_browser_bound_password_recovery.sql`. Its intent table and reserve/claim RPCs are service-role-only. Configure the server's `SUPABASE_SERVICE_ROLE_KEY` and the public Supabase URL and publishable key. Reconcile deployment state using the [deployment guide](deployment.md).
- Set the canonical Auth Site URL and narrow redirect entries for `/auth/callback` and `/reset-password?state=*`. Verify the provider's glob matching in isolated staging; add local/test origins only where needed.
- Recovery templates must use Supabase's `{{ .ConfirmationURL }}` so PKCE verification respects `redirectTo`. Raw-token, `token_hash` or site-root substitutions are incompatible. Signup templates must likewise respect the requested `/auth/callback` redirect.
- Keep `detectSessionInUrl: false`. The registration callback owns ordinary PKCE exchange, stages cookie writes, rejects recovery-purpose verifiers and preserves an existing signed-in account.
- Complete recovery within five minutes of requesting the email; opening it does not restart the provider deadline. The intent and browser-binding cookie have a 15-minute upper bound, which cannot extend provider validity. Recheck this assumption when changing provider configuration or SDK versions.
- Limits are one request per address per minute, five per address per hour and twenty per bound browser per hour, in addition to provider limits. Requests prune intent records older than one day. Do not log request bodies, code-bearing URLs or verifiers.
- For another browser or device, use **Request another reset email** there. There is no transferable token/OTP fallback.

## Demo email scope

Custom SMTP, a branded sender and general student-inbox delivery are deliberately deferred. The built-in sender restricts recipients to organization members; a controlled owner-inbox test does not establish student delivery. The request form explains this limitation in English and French without exposing a personal inbox or account existence. A suitable sender and verified institutional-inbox recovery are required before real student onboarding. See [Supabase SMTP guidance](https://supabase.com/docs/guides/auth/auth-smtp).

Email confirmation remains disabled for the demo. School-domain eligibility does not prove mailbox ownership or enrollment. Test confirmation flows before changing that policy. Registered demo addresses have no inbox and cannot verify recovery delivery.

## Verification

With the [native PostgreSQL prerequisites](../tests/helpers/README.md) installed, run:

```sh
REQUIRE_POSTGRES=1 node --test --test-concurrency=1 tests/password-recovery.test.mjs tests/password-recovery-route.test.mjs
```

These tests cover the installed SDK's PKCE exchange and failure paths, intended identity, binding, rate limits, concurrent one-use claims, revocation and the actual route's cookie handling. They use local fixtures, not remote Auth or delivered email.

In isolated HTTPS staging, also verify delivered-email completion, foreign-browser and cross-origin rejection, replay rejection, old-password and refresh-session revocation, and preservation of another account's session. Check signed-out, signed-in, name-restricted and banned account states separately. Keep credentials, inbox mappings, recovery links and execution receipts outside Git. Coordinate remaining release checks through the [deployment guide](deployment.md).
