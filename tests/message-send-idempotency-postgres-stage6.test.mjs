import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260816205747_message_send_idempotency_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);

const postgresBin = [
  process.env.POSTGRES_BIN,
  "/opt/homebrew/opt/postgresql@16/bin",
  "/usr/local/opt/postgresql@16/bin",
]
  .filter(Boolean)
  .find((candidate) => existsSync(join(candidate, "postgres")));

test(
  "PostgreSQL message operations replay one output, bind reservations, abort safely, and hide internals",
  { skip: !postgresBin, timeout: 45_000 },
  async () => {
    const cluster = await mkdtemp(join(tmpdir(), "smot-stage6-message-idempotency-"));
    const data = join(cluster, "data");
    const port = 49_152 + Math.floor(Math.random() * 10_000);
    let started = false;
    const command = (name, args, options = {}) => {
      const result = spawnSync(join(postgresBin, name), args, { encoding: "utf8", ...options });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return (result.stdout ?? "").trim();
    };
    const psqlArgs = [
      "-X", "-qAt", "-h", cluster, "-p", String(port), "-d", "postgres",
      "-v", "ON_ERROR_STOP=1",
    ];
    const sql = (statement, expectFailure = false) => {
      const result = spawnSync(join(postgresBin, "psql"), psqlArgs, {
        encoding: "utf8",
        input: statement,
      });

      if (expectFailure) {
        assert.notEqual(result.status, 0, `expected failure: ${statement}`);
        return result.stderr;
      }

      assert.equal(result.status, 0, result.stderr || result.stdout);
      return result.stdout.trim();
    };
    const asUserSql = (userId, statement) => `
      set role authenticated;
      set request.jwt.claims='{"role":"authenticated","sub":"${userId}"}';
      ${statement}
    `;
    const asUser = (userId, statement, expectFailure = false) =>
      sql(asUserSql(userId, statement), expectFailure);
    const runAsync = (statement) => new Promise((resolve, reject) => {
      const child = spawn(join(postgresBin, "psql"), psqlArgs, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(stderr || stdout));
      });
      child.stdin.end(statement);
    });

    const sender = "11111111-1111-4111-8111-111111111111";
    const recipient = "22222222-2222-4222-8222-222222222222";
    const otherSender = "33333333-3333-4333-8333-333333333333";
    const conversation = "44444444-4444-4444-8444-444444444444";
    const textOperation = "55555555-5555-4555-8555-555555555555";
    const concurrentOperation = "66666666-6666-4666-8666-666666666666";
    const mediaOperation = "77777777-7777-4777-8777-777777777777";
    const abortOperation = "88888888-8888-4888-8888-888888888888";
    const actorIsolationOperation = "99999999-9999-4999-8999-999999999999";
    const sendAbortRaceOperation = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const mediaPayload = JSON.stringify([
      {
        storage_path: `${conversation}/${sender}/one.png`,
        file_name: "one.png",
        mime_type: "image/png",
        size_bytes: 10,
      },
      {
        storage_path: `${conversation}/${sender}/two.jpg`,
        file_name: "two.jpg",
        mime_type: "image/jpeg",
        size_bytes: 20,
      },
    ]).replaceAll("'", "''");

    try {
      command("initdb", ["-D", data, "-A", "trust", "--no-locale", "--encoding=UTF8"]);
      command(
        "pg_ctl",
        ["-D", data, "-o", `-p ${port} -k ${cluster} -c listen_addresses=''`, "-w", "start"],
        { stdio: "ignore" },
      );
      started = true;
      sql(BOOTSTRAP_SQL);
      sql(migration);
      sql(`
        insert into auth.users(id) values ('${sender}'),('${recipient}'),('${otherSender}');
        insert into public.conversations(id,buyer_id,seller_id)
        values ('${conversation}','${sender}','${recipient}');
      `);

      assert.equal(
        sql("select has_schema_privilege('authenticated','message_send_private','usage');"),
        "f",
      );
      assert.equal(
        sql("select has_function_privilege('authenticated','public.send_conversation_message_idempotent(uuid,uuid,text,jsonb)','execute');"),
        "t",
      );
      assert.equal(
        sql("select has_function_privilege('service_role','public.send_conversation_message_idempotent(uuid,uuid,text,jsonb)','execute');"),
        "f",
      );
      assert.match(
        asUser(
          sender,
          `select message_send_private.send_impl('${textOperation}','${conversation}','hello','[]');`,
          true,
        ),
        /permission denied for schema message_send_private/i,
      );

      const firstMessageId = asUser(
        sender,
        `select send_conversation_message_idempotent(
          '${textOperation}','${conversation}',E'\uFEFF hello\r\nworld \u2003','[]'
        )->>'id';`,
      );
      assert.match(firstMessageId, /^[0-9a-f-]{36}$/i);
      assert.equal(
        asUser(
          sender,
          `select send_conversation_message_idempotent(
            '${textOperation}','${conversation}',E'hello\nworld','[]'
          )->>'id';`,
        ),
        firstMessageId,
      );
      assert.equal(
        sql(`select body=E'hello\nworld' from public.messages where id='${firstMessageId}';`),
        "t",
      );
      assert.equal(
        sql(`select count(*) from public.messages where conversation_id='${conversation}';`),
        "1",
      );
      assert.equal(sql("select count(*) from public.notifications;"), "1");
      assert.match(
        asUser(
          sender,
          `select send_conversation_message_idempotent(
            '${textOperation}','${conversation}','different','[]'
          );`,
          true,
        ),
        /message_send_operation_payload_conflict/i,
      );
      assert.match(
        asUser(
          sender,
          `select send_conversation_message_idempotent(
            gen_random_uuid(),'${conversation}',E'\u00A0\u2003\uFEFF','[]'
          );`,
          true,
        ),
        /message_send_payload_invalid/i,
      );
      assert.equal(
        asUser(
          sender,
          `select char_length(send_conversation_message_idempotent(
            gen_random_uuid(),'${conversation}',repeat('😀',2000),'[]'
          )->>'body');`,
        ),
        "2000",
      );
      assert.match(
        asUser(
          sender,
          `select send_conversation_message_idempotent(
            gen_random_uuid(),'${conversation}',repeat('😀',2001),'[]'
          );`,
          true,
        ),
        /message_send_payload_invalid/i,
      );

      const concurrentSql = asUserSql(
        sender,
        `select send_conversation_message_idempotent(
          '${concurrentOperation}','${conversation}','concurrent','[]'
        )->>'id';`,
      );
      const [concurrentFirst, concurrentSecond] = await Promise.all([
        runAsync(`set test.message_send_delay='0.35';${concurrentSql}`),
        runAsync(concurrentSql),
      ]);
      assert.equal(concurrentFirst, concurrentSecond);
      assert.equal(
        sql(`select count(*) from public.messages where body='concurrent';`),
        "1",
      );

      const reservationFirst = asUser(
        sender,
        `select reserve_message_media_uploads_idempotent(
          '${mediaOperation}','${conversation}','media','${mediaPayload}'::jsonb
        );`,
      );
      const reservationReplay = asUser(
        sender,
        `select reserve_message_media_uploads_idempotent(
          '${mediaOperation}','${conversation}','media','${mediaPayload}'::jsonb
        );`,
      );
      assert.equal(reservationReplay, reservationFirst);
      assert.equal(
        sql(`select count(*) from public.test_reservation_calls where actor_id='${sender}';`),
        "1",
      );
      assert.equal(
        sql(`select count(*) from private.message_media_upload_reservations
          where send_operation_id='${mediaOperation}';`),
        "2",
      );
      assert.match(
        asUser(
          sender,
          `select reserve_message_media_uploads_idempotent(
            '${mediaOperation}','${conversation}','media',
            jsonb_build_array(('${mediaPayload}'::jsonb)->1,('${mediaPayload}'::jsonb)->0)
          );`,
          true,
        ),
        /message_send_operation_payload_conflict/i,
      );
      assert.match(
        asUser(
          sender,
          `select reserve_message_media_uploads_idempotent(
            '${mediaOperation}','${conversation}','media',
            jsonb_set('${mediaPayload}'::jsonb,'{0,mime_type}','"image\/webp"')
          );`,
          true,
        ),
        /message_send_operation_payload_conflict/i,
      );
      assert.match(
        asUser(
          sender,
          `select reserve_message_media_uploads_idempotent(
            '${mediaOperation}','${conversation}','media',
            jsonb_set(
              '${mediaPayload}'::jsonb,
              '{0,storage_path}',
              to_jsonb('${conversation}/${sender}/changed.png'::text)
            )
          );`,
          true,
        ),
        /message_send_operation_payload_conflict/i,
      );
      assert.match(
        asUser(
          sender,
          `select reserve_message_media_uploads_idempotent(
            '${mediaOperation}','${conversation}','media',
            jsonb_set('${mediaPayload}'::jsonb,'{0,size_bytes}',to_jsonb(11))
          );`,
          true,
        ),
        /message_send_operation_payload_conflict/i,
      );

      const mediaMessageId = asUser(
        sender,
        `select send_conversation_message_idempotent(
          '${mediaOperation}','${conversation}','media','${mediaPayload}'::jsonb
        )->>'id';`,
      );
      assert.match(mediaMessageId, /^[0-9a-f-]{36}$/i);
      assert.equal(
        sql(`select count(*) from public.message_attachments where message_id='${mediaMessageId}';`),
        "2",
      );

      const abortPayload = JSON.stringify([
        {
          storage_path: `${conversation}/${sender}/abort.png`,
          file_name: "abort.png",
          mime_type: "image/png",
          size_bytes: 30,
        },
      ]).replaceAll("'", "''");
      asUser(
        sender,
        `select reserve_message_media_uploads_idempotent(
          '${abortOperation}','${conversation}','abort','${abortPayload}'::jsonb
        );`,
      );
      assert.equal(
        asUser(
          sender,
          `select abort_message_send_operation(
            '${abortOperation}','${conversation}','abort','${abortPayload}'::jsonb
          )->>'status';`,
        ),
        "aborted",
      );
      assert.match(
        asUser(
          sender,
          `select send_conversation_message_idempotent(
            '${abortOperation}','${conversation}','abort','${abortPayload}'::jsonb
          );`,
          true,
        ),
        /message_send_operation_aborted/i,
      );

      const raceSendSql = asUserSql(
        sender,
        `select send_conversation_message_idempotent(
          '${sendAbortRaceOperation}','${conversation}','race wins once','[]'
        )->>'id';`,
      );
      const raceAbortSql = asUserSql(
        sender,
        `select abort_message_send_operation(
          '${sendAbortRaceOperation}','${conversation}','race wins once','[]'
        )->>'status';`,
      );
      const sendPromise = runAsync(`set test.message_send_delay='0.35';${raceSendSql}`);
      await new Promise((resolve) => setTimeout(resolve, 75));
      const abortPromise = runAsync(raceAbortSql);
      const [raceMessageId, raceAbortStatus] = await Promise.all([sendPromise, abortPromise]);
      assert.match(raceMessageId, /^[0-9a-f-]{36}$/i);
      assert.equal(raceAbortStatus, "completed");
      assert.equal(sql("select count(*) from public.messages where body='race wins once';"), "1");

      const senderIsolationId = asUser(
        sender,
        `select send_conversation_message_idempotent(
          '${actorIsolationOperation}','${conversation}','sender copy','[]'
        )->>'id';`,
      );
      const otherIsolationId = asUser(
        recipient,
        `select send_conversation_message_idempotent(
          '${actorIsolationOperation}','${conversation}','recipient copy','[]'
        )->>'id';`,
      );
      assert.notEqual(senderIsolationId, otherIsolationId);

      assert.equal(
        sql("select count(*) from message_send_private.operations where status='completed';"),
        "7",
      );
      assert.match(
        sql(
          `set role authenticated; update message_send_private.operations set result='{}';`,
          true,
        ),
        /permission denied/i,
      );
    } finally {
      if (started) {
        spawnSync(join(postgresBin, "pg_ctl"), ["-D", data, "-m", "fast", "stop"]);
      }
      await rm(cluster, { recursive: true, force: true });
    }
  },
);

const BOOTSTRAP_SQL = String.raw`
create role postgres superuser;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create extension if not exists pgcrypto;
create schema auth;
create schema private;
create function auth.jwt() returns jsonb language sql stable
  as $body$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $body$;
create function auth.uid() returns uuid language sql stable
  as $body$ select nullif(coalesce(auth.jwt() ->> 'sub', ''), '')::uuid $body$;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.jwt(), auth.uid() to authenticated, service_role;

create table auth.users(id uuid primary key);
create table public.conversations(
  id uuid primary key,
  buyer_id uuid references auth.users(id),
  seller_id uuid references auth.users(id),
  listing_id uuid,
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  last_message_preview text
);
create table public.messages(
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id),
  sender_id uuid references auth.users(id),
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create table public.message_attachments(
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id),
  conversation_id uuid not null references public.conversations(id),
  uploader_id uuid not null references auth.users(id),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now()
);
create table public.notifications(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  type text not null,
  conversation_id uuid,
  message_id uuid
);
create table private.message_media_upload_reservations(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  conversation_id uuid not null references public.conversations(id),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table public.test_reservation_calls(
  id bigint generated always as identity primary key,
  actor_id uuid not null
);

create function public.reserve_message_media_uploads(
  p_conversation_id uuid,
  p_attachments jsonb
)
returns table(storage_path text, expires_at timestamptz)
language plpgsql security definer set search_path=''
as $body$
declare
  actor_id uuid := auth.uid();
  expiry timestamptz := now() + interval '30 minutes';
begin
  insert into public.test_reservation_calls(actor_id) values (actor_id);
  insert into private.message_media_upload_reservations(
    user_id,conversation_id,storage_path,file_name,mime_type,size_bytes,expires_at
  )
  select actor_id,p_conversation_id,item->>'storage_path',item->>'file_name',
    lower(item->>'mime_type'),(item->>'size_bytes')::bigint,expiry
  from jsonb_array_elements(p_attachments) item;
  return query
  select reservation.storage_path,reservation.expires_at
  from private.message_media_upload_reservations reservation
  where reservation.user_id=actor_id and reservation.conversation_id=p_conversation_id;
end $body$;

create function public.send_conversation_message_with_attachments(
  p_conversation_id uuid,
  p_body text default '',
  p_attachments jsonb default '[]'
)
returns public.messages
language plpgsql security definer set search_path=''
as $body$
declare
  actor_id uuid := auth.uid();
  message_row public.messages;
  recipient_id uuid;
  delay_seconds numeric := coalesce(nullif(current_setting('test.message_send_delay',true),''),'0')::numeric;
begin
  if delay_seconds>0 then perform pg_sleep(delay_seconds); end if;
  insert into public.messages(conversation_id,sender_id,body)
  values(p_conversation_id,actor_id,p_body) returning * into message_row;
  insert into public.message_attachments(
    message_id,conversation_id,uploader_id,storage_path,file_name,mime_type,size_bytes
  )
  select message_row.id,p_conversation_id,actor_id,item->>'storage_path',item->>'file_name',
    lower(item->>'mime_type'),(item->>'size_bytes')::bigint
  from jsonb_array_elements(p_attachments) item;
  delete from private.message_media_upload_reservations reservation
  where reservation.user_id=actor_id and reservation.conversation_id=p_conversation_id
    and reservation.storage_path in (
      select item->>'storage_path' from jsonb_array_elements(p_attachments) item
    );
  update public.conversations set last_message_at=message_row.created_at,
    updated_at=message_row.created_at,last_message_preview=left(p_body,140)
  where id=p_conversation_id;
  select case when buyer_id=actor_id then seller_id else buyer_id end into recipient_id
  from public.conversations where id=p_conversation_id;
  insert into public.notifications(user_id,type,conversation_id,message_id)
  values(recipient_id,'message',p_conversation_id,message_row.id);
  return message_row;
end $body$;

revoke all on function public.reserve_message_media_uploads(uuid,jsonb) from public,anon;
grant execute on function public.reserve_message_media_uploads(uuid,jsonb) to authenticated;
revoke all on function public.send_conversation_message_with_attachments(uuid,text,jsonb) from public,anon;
grant execute on function public.send_conversation_message_with_attachments(uuid,text,jsonb) to authenticated;
`;
