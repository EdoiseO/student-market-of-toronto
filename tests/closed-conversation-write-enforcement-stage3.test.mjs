import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createPostgresFixture, postgresAvailable } from "./helpers/postgres-fixture.mjs";

const migrationUrl = new URL(
  "../supabase/migrations/20260816081757_enforce_closed_conversation_writes.sql",
  import.meta.url,
);

async function migrationSource() {
  return readFile(migrationUrl, "utf8");
}

test("all participant conversation write surfaces share the effective-open guard", async () => {
  const sql = await migrationSource();

  assert.match(
    sql,
    /from public\.conversation_moderation_state state[\s\S]*for share/i,
  );
  assert.match(
    sql,
    /status = 'closed'[\s\S]*closed_until is null[\s\S]*closed_until > checked_at/i,
  );
  assert.match(
    sql,
    /p_actor_id is distinct from conversation_row\.buyer_id[\s\S]*p_actor_id is distinct from conversation_row\.seller_id/i,
  );
  assert.match(sql, /guard_conversation_message_insert[\s\S]*before insert on public\.messages/i);
  assert.match(sql, /guard_message_media_reservation_insert[\s\S]*before insert on private\.message_media_upload_reservations/i);
  assert.match(sql, /verify_open_conversation_message_media_insert[\s\S]*before insert on storage\.objects/i);
  assert.match(sql, /assert_open_conversation_attachment_insert[\s\S]*before insert on public\.message_attachments/i);
  assert.match(sql, /guard_conversation_message_reaction_write[\s\S]*before insert or update on public\.message_reactions/i);
});

test("service clients cannot bypass trusted functions with direct participant-table DML", async () => {
  const sql = await migrationSource();

  for (const table of ["messages", "message_attachments", "message_reactions"]) {
    assert.match(
      sql,
      new RegExp(
        `revoke insert, update, delete, truncate on table public\\.${table}[\\s\\S]{0,80}from service_role`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(`grant select on table public\\.${table} to service_role`, "i"),
    );
  }

  assert.doesNotMatch(
    sql,
    /revoke[^;]*(delete|select)[^;]*storage\.objects[^;]*service_role/i,
  );
  assert.doesNotMatch(
    sql,
    /revoke[^;]*(delete|truncate)[^;]*message_media_upload_reservations[^;]*service_role/i,
  );
});

test("announcement delivery scope is narrow and cannot unlock participant messages or reactions", async () => {
  const sql = await migrationSource();

  assert.match(sql, /write_scope = 'announcement_delivery'/i);
  assert.match(sql, /auth\.jwt\(\) ->> 'role'[\s\S]*service_role/i);
  assert.match(
    sql,
    /function private\.guard_announcement_message_write_origin\(\)[\s\S]*security invoker[\s\S]*current_user <> 'postgres'/i,
  );
  assert.match(sql, /conversation_listing_id is not null[\s\S]*announcement_message_requires_system_conversation/i);
  assert.match(sql, /system_scope_cannot_write_message_reactions/i);
  assert.match(sql, /announcement_conversation_is_read_only/i);
});

test("reaction removals preserve cleanup semantics but still require open state and an active account", async () => {
  const sql = await migrationSource();

  assert.match(sql, /is_reactivation_or_add := new\.removed_at is null/i);
  assert.match(
    sql,
    /assert_conversation_participant_write_allowed\([\s\S]*is_reactivation_or_add/i,
  );
  const assertion = sql.slice(
    sql.indexOf("create or replace function private.assert_conversation_participant_write_allowed"),
    sql.indexOf("alter function private.assert_conversation_participant_write_allowed"),
  );
  const optionalActiveChecks = assertion.indexOf(
    "if not coalesce(p_require_active_messaging",
  );
  assert.ok(assertion.indexOf("conversation_write_closed") < optionalActiveChecks);
  assert.ok(assertion.indexOf("conversation_write_actor_banned") < optionalActiveChecks);
});

const BUYER = "11111111-1111-4111-8111-111111111111";
const SELLER = "22222222-2222-4222-8222-222222222222";
const OUTSIDER = "33333333-3333-4333-8333-333333333333";
const SYSTEM_SENDER = "44444444-4444-4444-8444-444444444444";
const LISTING = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONVERSATION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SYSTEM_CONVERSATION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LEGACY_NULL_PARTICIPANT_CONVERSATION = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jwtFor(role, sub = null) {
  return JSON.stringify(sub ? { role, sub } : { role });
}

test(
  "PostgreSQL enforces close/reopen/expiry, actor, media, reaction, scope, and lock boundaries",
  { skip: !postgresAvailable, timeout: 30_000 },
  async (t) => {
    const migration = await migrationSource();
    const fixture = createPostgresFixture(t);

    const execute = (statement, { allowFailure = false } = {}) => {
      const result = fixture.result(statement);
      if (!allowFailure) {
        assert.equal(result.status, 0, result.stderr || result.stdout);
      }
      return result;
    };

    const asRole = (role, sub, statement, options) =>
      execute(
        `begin;
         set local role ${role};
         do $claims$ begin
           perform set_config(
             'request.jwt.claims',
             ${sqlLiteral(jwtFor(role, sub))},
             true
           );
         end $claims$;
         ${statement}
         commit;`,
        options,
      );

    const expectFailure = (role, sub, statement, pattern) => {
      const result = asRole(role, sub, statement, { allowFailure: true });
      assert.notEqual(result.status, 0, `Expected failure for: ${statement}`);
      assert.match(`${result.stderr}\n${result.stdout}`, pattern);
    };

    try {

      execute(`
        create role postgres superuser;
        create role anon nologin;
        create role authenticated nologin;
        create role service_role nologin bypassrls;
        create role untrusted_announcement_writer nologin;
        create schema auth;
        create schema storage;
        create schema private;

        create function auth.uid() returns uuid
        language sql stable
        as $$
          select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
        $$;
        create function auth.jwt() returns jsonb
        language sql stable
        as $$
          select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
        $$;

        create table auth.users (
          id uuid primary key,
          banned_until timestamptz
        );
        create table public.user_status (
          user_id uuid primary key,
          is_banned boolean not null default false,
          banned_until timestamptz
        );
        create table public.listings (
          id uuid primary key,
          status text not null
        );
        create table public.conversations (
          id uuid primary key,
          listing_id uuid,
          buyer_id uuid,
          seller_id uuid
        );
        create table public.conversation_moderation_state (
          conversation_id uuid primary key,
          version bigint not null default 0,
          status text not null default 'open',
          reason_code text,
          user_message text,
          closed_until timestamptz,
          changed_at timestamptz not null default now()
        );
        create table public.blocked_users (
          blocker_user_id uuid not null,
          blocked_user_id uuid not null,
          primary key (blocker_user_id, blocked_user_id)
        );
        create table public.messages (
          id uuid primary key default gen_random_uuid(),
          conversation_id uuid not null,
          sender_id uuid not null,
          body text not null default '',
          created_at timestamptz not null default now(),
          read_at timestamptz
        );
        create table public.message_attachments (
          id uuid primary key default gen_random_uuid(),
          message_id uuid not null,
          conversation_id uuid not null,
          uploader_id uuid not null,
          storage_path text not null unique,
          file_name text not null,
          mime_type text not null,
          size_bytes bigint not null,
          created_at timestamptz not null default now()
        );
        create table public.message_reactions (
          message_id uuid not null,
          conversation_id uuid not null,
          user_id uuid not null,
          emoji text not null,
          created_at timestamptz not null default now(),
          removed_at timestamptz,
          primary key (message_id, user_id, emoji)
        );
        create table private.message_media_upload_reservations (
          id uuid primary key default gen_random_uuid(),
          user_id uuid not null,
          conversation_id uuid not null,
          storage_path text not null unique,
          file_name text not null,
          mime_type text not null,
          size_bytes bigint not null,
          created_at timestamptz not null default now(),
          expires_at timestamptz not null
        );
        create table storage.objects (
          id uuid primary key default gen_random_uuid(),
          bucket_id text not null,
          name text not null,
          owner_id text,
          metadata jsonb
        );

        insert into auth.users (id) values
          ('${BUYER}'), ('${SELLER}'), ('${OUTSIDER}'), ('${SYSTEM_SENDER}');
        insert into public.user_status (user_id) values
          ('${BUYER}'), ('${SELLER}'), ('${OUTSIDER}'), ('${SYSTEM_SENDER}');
        insert into public.listings values ('${LISTING}', 'active');
        insert into public.conversations values
          ('${CONVERSATION}', '${LISTING}', '${BUYER}', '${SELLER}'),
          ('${SYSTEM_CONVERSATION}', null, '${BUYER}', '${SYSTEM_SENDER}'),
          ('${LEGACY_NULL_PARTICIPANT_CONVERSATION}', '${LISTING}', '${BUYER}', null);
        insert into public.conversation_moderation_state (conversation_id) values
          ('${CONVERSATION}'), ('${SYSTEM_CONVERSATION}'),
          ('${LEGACY_NULL_PARTICIPANT_CONVERSATION}');

        grant usage on schema public, auth, storage to authenticated, service_role;
        grant select on public.conversations, public.listings, public.user_status,
          public.blocked_users, public.conversation_moderation_state to authenticated, service_role;
        grant select on public.messages, public.message_attachments, public.message_reactions
          to authenticated;
        grant insert on public.message_reactions to authenticated;
        grant update (removed_at) on public.message_reactions to authenticated;
        grant all on public.messages, public.message_attachments, public.message_reactions
          to service_role;
        grant insert on public.messages to untrusted_announcement_writer;
        grant insert on storage.objects to authenticated;
        grant select, insert, delete on storage.objects to service_role;

        create function public.test_send(p_conversation_id uuid, p_body text)
        returns uuid language plpgsql security definer set search_path = '' as $$
        declare output_id uuid;
        begin
          insert into public.messages (conversation_id, sender_id, body)
          values (p_conversation_id, auth.uid(), p_body)
          returning id into output_id;
          return output_id;
        end $$;

        create function public.test_reserve(p_conversation_id uuid, p_path text)
        returns uuid language plpgsql security definer set search_path = '' as $$
        declare output_id uuid;
        begin
          insert into private.message_media_upload_reservations (
            user_id, conversation_id, storage_path, file_name, mime_type,
            size_bytes, expires_at
          ) values (
            auth.uid(), p_conversation_id, p_path, 'photo.png', 'image/png',
            100, now() + interval '30 minutes'
          ) returning id into output_id;
          return output_id;
        end $$;

        create function public.test_attach(
          p_message_id uuid, p_conversation_id uuid, p_path text
        ) returns uuid language plpgsql security definer set search_path = '' as $$
        declare output_id uuid;
        begin
          insert into public.message_attachments (
            message_id, conversation_id, uploader_id, storage_path,
            file_name, mime_type, size_bytes
          ) values (
            p_message_id, p_conversation_id, auth.uid(), p_path,
            'photo.png', 'image/png', 100
          ) returning id into output_id;
          return output_id;
        end $$;

        create function public.test_system_message(p_conversation_id uuid)
        returns uuid language plpgsql security definer set search_path = '' as $$
        declare output_id uuid;
        begin
          perform set_config('smot.conversation_write_scope', 'announcement_delivery', true);
          insert into public.messages (conversation_id, sender_id, body)
          values (p_conversation_id, '${SYSTEM_SENDER}', 'System announcement')
          returning id into output_id;
          perform set_config('smot.conversation_write_scope', '', true);
          return output_id;
        end $$;

        create function public.test_spoofed_system_message(p_conversation_id uuid)
        returns uuid language plpgsql security definer set search_path = '' as $$
        declare output_id uuid := gen_random_uuid();
        begin
          perform set_config('smot.conversation_write_scope', 'announcement_delivery', true);
          insert into public.messages (id, conversation_id, sender_id, body)
          values (
            output_id, p_conversation_id, '${SYSTEM_SENDER}',
            'Spoofed system announcement'
          );
          perform set_config('smot.conversation_write_scope', '', true);
          return output_id;
        end $$;

        alter function public.test_system_message(uuid) owner to postgres;
        alter function public.test_spoofed_system_message(uuid)
          owner to untrusted_announcement_writer;

        revoke all on function public.test_send(uuid, text),
          public.test_reserve(uuid, text), public.test_attach(uuid, uuid, text),
          public.test_system_message(uuid), public.test_spoofed_system_message(uuid)
          from public;
        grant execute on function public.test_send(uuid, text),
          public.test_reserve(uuid, text), public.test_attach(uuid, uuid, text)
          to authenticated;
        grant execute on function public.test_system_message(uuid),
          public.test_spoofed_system_message(uuid) to service_role;
      `);

      execute(migration);

      const firstMessage = asRole(
        "authenticated",
        BUYER,
        `select public.test_send('${CONVERSATION}', 'open send');`,
      ).stdout.trim();
      assert.match(firstMessage, /^[0-9a-f-]{36}$/i);

      execute(`
        update public.conversation_moderation_state
        set status = 'closed', closed_until = null
        where conversation_id = '${CONVERSATION}';
      `);
      expectFailure(
        "authenticated",
        BUYER,
        `select public.test_send('${CONVERSATION}', 'closed send');`,
        /conversation_write_closed/i,
      );
      expectFailure(
        "authenticated",
        BUYER,
        `insert into public.messages (conversation_id, sender_id, body)
         values ('${CONVERSATION}', '${BUYER}', 'direct data api');`,
        /permission denied.*messages/i,
      );
      expectFailure(
        "service_role",
        null,
        `insert into public.messages (conversation_id, sender_id, body)
         values ('${CONVERSATION}', '${SYSTEM_SENDER}', 'direct service');`,
        /permission denied.*messages/i,
      );

      execute(`
        update public.conversation_moderation_state
        set status = 'closed', closed_until = now() - interval '1 second'
        where conversation_id = '${CONVERSATION}';
      `);
      assert.match(
        asRole(
          "authenticated",
          BUYER,
          `select public.test_send('${CONVERSATION}', 'expired closure');`,
        ).stdout,
        /[0-9a-f-]{36}/i,
      );

      execute(`
        update public.conversation_moderation_state
        set status = 'open', closed_until = null
        where conversation_id = '${CONVERSATION}';
        update auth.users set banned_until = now() + interval '1 day' where id = '${BUYER}';
      `);
      expectFailure(
        "authenticated",
        BUYER,
        `select public.test_send('${CONVERSATION}', 'auth banned');`,
        /conversation_write_actor_banned/i,
      );
      execute(`
        update auth.users set banned_until = null where id = '${BUYER}';
        update public.user_status set is_banned = true, banned_until = null where user_id = '${BUYER}';
      `);
      expectFailure(
        "authenticated",
        BUYER,
        `select public.test_send('${CONVERSATION}', 'status banned');`,
        /conversation_write_actor_banned/i,
      );
      execute(`update public.user_status set is_banned = false where user_id = '${BUYER}';`);
      expectFailure(
        "authenticated",
        OUTSIDER,
        `select public.test_send('${CONVERSATION}', 'outsider');`,
        /conversation_write_forbidden/i,
      );
      expectFailure(
        "authenticated",
        OUTSIDER,
        `select public.test_send(
          '${LEGACY_NULL_PARTICIPANT_CONVERSATION}', 'legacy null outsider'
        );`,
        /conversation_write_forbidden/i,
      );

      const reactionMessage = asRole(
        "authenticated",
        BUYER,
        `select public.test_send('${CONVERSATION}', 'reaction target');`,
      ).stdout.trim();
      asRole(
        "authenticated",
        BUYER,
        `insert into public.message_reactions
           (message_id, conversation_id, user_id, emoji)
         values ('${reactionMessage}', '${CONVERSATION}', '${BUYER}', '👍');`,
      );
      execute(`
        update public.conversation_moderation_state
        set status = 'closed', closed_until = null
        where conversation_id = '${CONVERSATION}';
      `);
      expectFailure(
        "authenticated",
        BUYER,
        `update public.message_reactions set removed_at = now()
         where message_id = '${reactionMessage}' and user_id = '${BUYER}' and emoji = '👍';`,
        /conversation_write_closed/i,
      );
      expectFailure(
        "authenticated",
        BUYER,
        `select public.test_reserve('${CONVERSATION}', '${CONVERSATION}/${BUYER}/closed.png');`,
        /conversation_write_closed/i,
      );
      expectFailure(
        "authenticated",
        BUYER,
        `select public.test_attach('${reactionMessage}', '${CONVERSATION}', 'closed-finalize.png');`,
        /conversation_write_closed/i,
      );

      execute(`
        update public.conversation_moderation_state
        set status = 'open', closed_until = null
        where conversation_id = '${CONVERSATION}';
        update public.listings set status = 'inactive' where id = '${LISTING}';
      `);
      asRole(
        "authenticated",
        BUYER,
        `update public.message_reactions set removed_at = now()
         where message_id = '${reactionMessage}' and user_id = '${BUYER}' and emoji = '👍';`,
      );
      execute(`update public.listings set status = 'active' where id = '${LISTING}';`);

      asRole(
        "authenticated",
        BUYER,
        `select public.test_reserve(
          '${CONVERSATION}', '${CONVERSATION}/${BUYER}/preflight.png'
        );`,
      );
      asRole(
        "authenticated",
        BUYER,
        `insert into storage.objects (bucket_id, name, owner_id, metadata)
         values (
           'message-media', '${CONVERSATION}/${BUYER}/preflight.png', '${BUYER}',
           '{"mimetype":"image/png"}'::jsonb
         );`,
      );

      asRole(
        "authenticated",
        BUYER,
        `select public.test_reserve(
          '${CONVERSATION}', '${CONVERSATION}/${BUYER}/open.png'
        );`,
      );
      execute(`
        update public.conversation_moderation_state
        set status = 'closed', closed_until = null
        where conversation_id = '${CONVERSATION}';
      `);
      expectFailure(
        "service_role",
        null,
        `insert into storage.objects (bucket_id, name, owner_id, metadata)
         values (
           'message-media', '${CONVERSATION}/${BUYER}/open.png', '${BUYER}',
           '{"mimetype":"image/png","size":"100"}'::jsonb
         );`,
        /conversation_write_closed/i,
      );

      expectFailure(
        "service_role",
        null,
        `select set_config('smot.conversation_write_scope', 'announcement_delivery', true);
         insert into public.messages (conversation_id, sender_id, body)
         values ('${SYSTEM_CONVERSATION}', '${SYSTEM_SENDER}', 'scope spoof');`,
        /permission denied.*messages/i,
      );
      expectFailure(
        "service_role",
        null,
        `select public.test_spoofed_system_message('${SYSTEM_CONVERSATION}');`,
        /announcement_message_write_requires_postgres_owner/i,
      );
      assert.match(
        asRole(
          "service_role",
          null,
          `select public.test_system_message('${SYSTEM_CONVERSATION}');`,
        ).stdout,
        /[0-9a-f-]{36}/i,
      );
      expectFailure(
        "service_role",
        null,
        `select public.test_system_message('${CONVERSATION}');`,
        /announcement_message_requires_system_conversation/i,
      );

      // Account deletion only needs attachment-path SELECT plus Storage DELETE;
      // Auth/profile cascades execute internally and are not a service DML API.
      asRole("service_role", null, "select count(*) from public.message_attachments;");
      asRole(
        "service_role",
        null,
        `delete from storage.objects
         where bucket_id = 'message-media'
           and name = '${CONVERSATION}/${BUYER}/preflight.png';`,
      );
      assert.equal(
        execute(`
          select count(*) from storage.objects
          where bucket_id = 'message-media'
            and name = '${CONVERSATION}/${BUYER}/preflight.png';
        `).stdout.trim(),
        "0",
      );

      // A close holding FOR UPDATE must serialize ahead of a sender's FOR SHARE.
      execute(`
        update public.conversation_moderation_state
        set status = 'open', closed_until = null
        where conversation_id = '${CONVERSATION}';
      `);
      const locker = fixture.spawnSql();
      locker.stdin.write(`begin;
        update public.conversation_moderation_state
        set status = 'closed', closed_until = null
        where conversation_id = '${CONVERSATION}';
        select 'STATE_LOCKED';\n`);

      await locker.waitForOutput("STATE_LOCKED");

      const waitingSend = fixture.spawnSql();
      let waitingOutput = "";
      let waitingError = "";
      let waitingExited = false;
      waitingSend.stdout.setEncoding("utf8");
      waitingSend.stderr.setEncoding("utf8");
      waitingSend.stdout.on("data", (chunk) => {
        waitingOutput += chunk;
      });
      waitingSend.stderr.on("data", (chunk) => {
        waitingError += chunk;
      });
      waitingSend.on("exit", () => {
        waitingExited = true;
      });
      waitingSend.stdin.end(`begin;
        set local role authenticated;
        select set_config(
          'request.jwt.claims',
          ${sqlLiteral(jwtFor("authenticated", BUYER))},
          true
        );
        select public.test_send('${CONVERSATION}', 'racing send');
        commit;\n`);

      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(waitingExited, false, "sender must wait for the moderation state lock");

      locker.stdin.end("commit;\n\\q\n");
      const lockerResult = await locker.completion;
      assert.equal(lockerResult.status, 0, lockerResult.stderr || "locker failed");
      const { status: waitingCode } = await waitingSend.completion;
      assert.notEqual(waitingCode, 0, waitingOutput);
      assert.match(waitingError, /conversation_write_closed/i);
    } finally {
      fixture.dispose();
    }
  },
);
