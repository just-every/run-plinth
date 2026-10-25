import { need, type Actor } from './model'
/** Fixed-window limits follow the authenticated person across credential replacement. */
export async function apiLimit(db: D1Database, actor: Actor) {
 const window = Math.floor(Date.now()/60_000)
 const count = await db.prepare('INSERT INTO pl_api_limits(principal,window,count) VALUES(?,?,1) ON CONFLICT(principal) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window RETURNING count').bind(actor.id, window).first<{count: number}>()
 need(count && count.count <= 60, 'Native API limit is 60 requests per person per UTC minute', 429, 'rate_limit')
}
