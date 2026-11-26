/** Roll raw messages/events up into daily_stats (per day, campaign, account) for fast analytics charts. */
import { prisma } from '@mailflow/db';
import { getSettings } from '@mailflow/core';

export async function rollupStats(days = 2, now = new Date()) {
  const s = await getSettings();
  const tz = s.defaultTimezone;
  const since = new Date(now.getTime() - days * 86_400_000);
  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM daily_stats WHERE date >= to_char((${since}::timestamptz AT TIME ZONE ${tz}), 'YYYY-MM-DD')`,
    prisma.$executeRaw`
      WITH start AS (
        SELECT (date_trunc('day', ${since}::timestamptz AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS t
      ),
      sent AS (
        SELECT to_char(m.sent_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS d, m.campaign_id AS c, coalesce(m.account_id, '') AS a, COUNT(*)::int AS n
        FROM messages m, start WHERE m.status = 'sent' AND m.sent_at >= start.t GROUP BY 1, 2, 3
      ),
      ev AS (
        SELECT to_char(e.at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS d, e.campaign_id AS c, coalesce(e.account_id, '') AS a,
          COUNT(DISTINCT e.lead_id) FILTER (WHERE e.type = 'open')::int AS opens,
          COUNT(DISTINCT e.lead_id) FILTER (WHERE e.type = 'click')::int AS clicks,
          COUNT(DISTINCT e.lead_id) FILTER (WHERE e.type = 'reply')::int AS replies,
          COUNT(DISTINCT e.lead_id) FILTER (WHERE e.type = 'bounce')::int AS bounces,
          COUNT(DISTINCT e.lead_id) FILTER (WHERE e.type = 'unsubscribe')::int AS unsubs
        FROM events e, start WHERE e.at >= start.t AND e.type <> 'sent' GROUP BY 1, 2, 3
      )
      INSERT INTO daily_stats (id, date, campaign_id, account_id, sent, opens, clicks, replies, bounces, unsubscribes, created_at, updated_at)
      SELECT 'ds' || md5(coalesce(s.d, e.d) || coalesce(s.c, e.c) || coalesce(s.a, e.a)), coalesce(s.d, e.d), coalesce(s.c, e.c), coalesce(s.a, e.a),
        coalesce(s.n, 0), coalesce(e.opens, 0), coalesce(e.clicks, 0), coalesce(e.replies, 0), coalesce(e.bounces, 0), coalesce(e.unsubs, 0), now(), now()
      FROM sent s FULL OUTER JOIN ev e ON s.d = e.d AND s.c = e.c AND s.a = e.a
    `,
  ]);
}
