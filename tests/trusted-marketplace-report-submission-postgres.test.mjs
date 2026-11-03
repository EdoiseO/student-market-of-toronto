import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createPostgresFixture, postgresAvailable } from "./helpers/postgres-fixture.mjs";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260816193136_trusted_marketplace_report_submission.sql",
    import.meta.url,
  ),
  "utf8",
);

const BOOTSTRAP_SQL = String.raw`
create role postgres superuser;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.jwt() returns jsonb language sql stable
  as $body$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $body$;
create function auth.uid() returns uuid language sql stable
  as $body$ select nullif(coalesce(auth.jwt() ->> 'sub', ''), '')::uuid $body$;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.jwt(), auth.uid() to authenticated, service_role;

create table auth.users(id uuid primary key);
create table public.user_status(
  user_id uuid primary key references auth.users(id),
  is_banned boolean not null default false,
  banned_until timestamptz
);
create table public.profiles(
  id uuid primary key references auth.users(id),
  is_public boolean not null default true
);
create table public.listings(
  id uuid primary key,
  seller_id uuid not null references auth.users(id),
  status text not null,
  retired_at timestamptz
);
create table public.conversations(
  id uuid primary key,
  buyer_id uuid references auth.users(id),
  seller_id uuid references auth.users(id),
  listing_id uuid references public.listings(id)
);
create table public.messages(
  id uuid primary key,
  conversation_id uuid not null references public.conversations(id),
  sender_id uuid references auth.users(id)
);
create table public.reports(
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid references auth.users(id),
  reported_user_id uuid references auth.users(id),
  subject_type text,
  subject_id uuid,
  listing_id uuid references public.listings(id),
  message_id uuid references public.messages(id),
  conversation_id uuid references public.conversations(id),
  reason text,
  details text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz
);
grant insert on public.reports to authenticated;
`;

test(
  "trusted report RPC derives visible bindings and canonically replays CRLF input",
  { skip: !postgresAvailable, timeout: 30_000 },
  async (t) => {
    const fixture = createPostgresFixture(t);
    const sql = (statement, expectFailure = false) => {
      const result = fixture.result(statement);
      if (expectFailure) {
        assert.notEqual(result.status, 0, `expected failure: ${statement}`);
        return result.stderr;
      }
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return result.stdout.trim();
    };
    const asUser = (userId, statement, expectFailure = false) =>
      sql(
        `set role authenticated; set request.jwt.claims='{"role":"authenticated","sub":"${userId}"}';${statement}`,
        expectFailure,
      );

    const reporter = "11111111-1111-4111-8111-111111111111";
    const seller = "22222222-2222-4222-8222-222222222222";
    const outsider = "33333333-3333-4333-8333-333333333333";
    const privateProfile = "44444444-4444-4444-8444-444444444444";
    const activeListing = "55555555-5555-4555-8555-555555555555";
    const inactiveListing = "66666666-6666-4666-8666-666666666666";
    const conversation = "77777777-7777-4777-8777-777777777777";
    const message = "88888888-8888-4888-8888-888888888888";
    const nullableConversation = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const nullableMessage = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const listingOperation = "99999999-9999-4999-8999-999999999999";
    const messageOperation = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const profileOperation = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const toggledProfileOperation = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const nullableMessageOperation = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    try {
      sql(BOOTSTRAP_SQL);
      sql(migration);
      sql(`
        insert into auth.users(id) values
          ('${reporter}'),('${seller}'),('${outsider}'),('${privateProfile}');
        insert into profiles(id,is_public) values
          ('${seller}',false),('${privateProfile}',true);
        insert into listings(id,seller_id,status) values
          ('${activeListing}','${seller}','active'),
          ('${inactiveListing}','${seller}','inactive');
        insert into conversations(id,buyer_id,seller_id,listing_id)
          values
            ('${conversation}','${reporter}','${seller}','${activeListing}'),
            ('${nullableConversation}','${reporter}',null,null);
        insert into messages(id,conversation_id,sender_id)
          values
            ('${message}','${conversation}','${seller}'),
            ('${nullableMessage}','${nullableConversation}','${seller}');
      `);

      assert.equal(
        sql("select has_table_privilege('authenticated','public.reports','insert');"),
        "t",
      );
      assert.match(
        asUser(
          reporter,
          `select report_submission_private.submit_marketplace_report_impl(
            'listing','${activeListing}','spam','details','${listingOperation}'
          );`,
          true,
        ),
        /permission denied for schema report_submission_private/i,
      );
      const listingReportId = asUser(
          reporter,
          `select submit_marketplace_report(
            'listing','${activeListing}','other',
            chr(65279)||E'Useful line one\rUseful line two'||chr(8195),'${listingOperation}'
          )->>'id';`,
      );
      assert.match(listingReportId, /^[0-9a-f-]{36}$/i);
      assert.equal(
        asUser(
          reporter,
          `select submit_marketplace_report(
            'listing','${activeListing}','other',E'Useful line one\nUseful line two','${listingOperation}'
          )->>'id';`,
        ),
        listingReportId,
      );
      assert.equal(
        sql(`select reporter_user_id='${reporter}' and reported_user_id='${seller}'
          and listing_id='${activeListing}' and details=E'Useful line one\nUseful line two'
          from reports where id='${listingReportId}';`),
        "t",
      );
      sql(`update reports set status='resolved',reviewed_by='${outsider}',reviewed_at=now()
        where id='${listingReportId}';`);
      assert.equal(
        asUser(
          reporter,
          `select submit_marketplace_report(
            'listing','${activeListing}','other',E'Useful line one\nUseful line two','${listingOperation}'
          ) = jsonb_build_object('id','${listingReportId}'::uuid,'status','open');`,
        ),
        "t",
      );
      assert.match(
        asUser(
          reporter,
          `select submit_marketplace_report(
            'listing','${activeListing}','other','A conflicting detail','${listingOperation}'
          )->>'id';`,
          true,
        ),
        /report_operation_payload_conflict/,
      );
      assert.match(
        asUser(
          reporter,
          `select submit_marketplace_report(
            'listing','${inactiveListing}','spam',null,gen_random_uuid()
          )->>'id';`,
          true,
        ),
        /report_subject_not_found/,
      );
      const profileReportId = asUser(
        reporter,
        `select submit_marketplace_report(
          'profile','${seller}','spam',null,'${profileOperation}'
        )->>'id';`,
      );
      assert.equal(
        sql(`select reported_user_id='${seller}' and subject_id='${seller}'
          from reports where id='${profileReportId}';`),
        "t",
      );
      const toggledProfileReportId = asUser(
        reporter,
        `select submit_marketplace_report(
          'profile','${privateProfile}','spam',null,'${toggledProfileOperation}'
        )->>'id';`,
      );
      assert.equal(
        sql(`select reported_user_id='${privateProfile}' and subject_id='${privateProfile}'
          from reports where id='${toggledProfileReportId}';`),
        "t",
      );
      assert.match(
        asUser(
          outsider,
          `select submit_marketplace_report(
            'message','${message}','harassment',null,gen_random_uuid()
          )->>'id';`,
          true,
        ),
        /report_subject_access_denied/,
      );
      const messageReportId = asUser(
        reporter,
        `select submit_marketplace_report(
          'message','${message}','harassment',null,'${messageOperation}'
        )->>'id';`,
      );
      assert.equal(
        sql(`select reported_user_id='${seller}' and message_id='${message}'
          and conversation_id='${conversation}' and listing_id='${activeListing}'
          from reports where id='${messageReportId}';`),
        "t",
      );
      assert.match(
        asUser(
          outsider,
          `select submit_marketplace_report(
            'message','${nullableMessage}','harassment',null,gen_random_uuid()
          )->>'id';`,
          true,
        ),
        /report_subject_access_denied/,
      );
      const nullableMessageReportId = asUser(
        reporter,
        `select submit_marketplace_report(
          'message','${nullableMessage}','harassment',null,'${nullableMessageOperation}'
        )->>'id';`,
      );
      assert.equal(
        sql(`select reported_user_id='${seller}' and message_id='${nullableMessage}'
          and conversation_id='${nullableConversation}'
          from reports where id='${nullableMessageReportId}';`),
        "t",
      );
      assert.match(
        asUser(
          reporter,
          `select submit_marketplace_report(
            'listing','${activeListing}','other','short',gen_random_uuid()
          )->>'id';`,
          true,
        ),
        /report_details_invalid/,
      );
      for (const whitespaceExpression of [
        "E'\\t\\r\\n'",
        "chr(160)",
        "chr(8195)",
        "chr(65279)",
      ]) {
        assert.match(
          asUser(
            reporter,
            `select submit_marketplace_report(
              'listing','${activeListing}','other',${whitespaceExpression},gen_random_uuid()
            );`,
            true,
          ),
          /report_details_invalid/,
        );
      }
      sql(`insert into user_status(user_id,is_banned) values ('${reporter}',true);`);
      assert.equal(
        asUser(
          reporter,
          `select submit_marketplace_report(
            'listing','${activeListing}','other',
            E'Useful line one\nUseful line two','${listingOperation}'
          )->>'id';`,
        ),
        listingReportId,
      );
      assert.match(
        asUser(
          reporter,
          `select submit_marketplace_report(
            'listing','${activeListing}','spam',null,'${listingOperation}'
          )->>'id';`,
          true,
        ),
        /report_operation_payload_conflict/,
      );
      assert.match(
        asUser(
          reporter,
          `select submit_marketplace_report(
            'listing','${activeListing}','spam',null,gen_random_uuid()
          )->>'id';`,
          true,
        ),
        /account_banned/,
      );
    } finally {
      fixture.dispose();
    }
  },
);
