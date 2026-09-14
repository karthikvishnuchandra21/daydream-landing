/**
 * Campaign short links — count the tap, then send the person to the App Store.
 *
 * daydreamers.app/liz → App Store campaign URL (ct=liz). Apple counts the
 * campaign on its side, but its Analytics Reports API withholds small
 * campaigns (rows below 5 per day-level dimension combination), so the tap
 * itself is the one number we own. Each tap is inserted into
 * campaign_link_taps with the public anon key (insert-only policy) and the
 * redirect never waits on it.
 *
 * Adding a link: one entry in CAMPAIGNS below (the ct= value must match the
 * campaign generated in App Store Connect), deploy with `vercel --prod` from
 * this directory, and the admin Campaigns tab picks it up by name. The static
 * vercel.json redirects no longer carry campaign links; this file does.
 *
 * Env on the daydream-landing Vercel project: SUPABASE_URL, SUPABASE_ANON_KEY.
 */

const APP_ID = '6763168108';
const PROVIDER_TOKEN = '128232174';

const CAMPAIGNS = {
  liz: 'liz',
};

// Vercel reads this statically: keep it a plain literal, one entry per
// CAMPAIGNS key.
export const config = {
  matcher: ['/liz'],
};

const appStoreUrl = (ct) =>
  `https://apps.apple.com/app/apple-store/id${APP_ID}?pt=${PROVIDER_TOKEN}&ct=${encodeURIComponent(ct)}&mt=8`;

// Link-preview fetchers and crawlers: an iMessage or Instagram preview hits
// the URL once when the link is pasted, before anyone taps it. Kept in the
// table flagged, never counted.
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|facebookcatalog|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|slackbot|skypeuripreview|pinterest|embedly|quora link|vkshare|applebot|snapchat|redditbot|bitlybot|curl|wget|python-requests|go-http-client|headless|lighthouse|pagespeed|gtmetrix|monitor|uptime|vercel-screenshot/i;

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function recordTap(request, campaign) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return;

  const ua = (request.headers.get('user-agent') || '').slice(0, 400);
  const ip = request.headers.get('x-real-ip') || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const ipHash = ip ? (await sha256Hex(ip)).slice(0, 16) : null;
  const referer = (request.headers.get('referer') || '').slice(0, 400) || null;
  const country = request.geo?.country || request.headers.get('x-vercel-ip-country') || null;

  await fetch(`${url}/rest/v1/campaign_link_taps`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      campaign,
      ip_hash: ipHash,
      user_agent: ua || null,
      referer,
      country,
      is_bot: BOT_RE.test(ua) || !ua,
    }),
  });
}

export default function middleware(request, context) {
  const name = new URL(request.url).pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  const ct = CAMPAIGNS[name];
  if (!ct) return; // not a campaign path; fall through to the site

  // Count without holding the redirect: waitUntil keeps the edge function
  // alive for the insert after the response has gone out.
  const pending = recordTap(request, ct).catch(() => {});
  if (context?.waitUntil) context.waitUntil(pending);

  return Response.redirect(appStoreUrl(ct), 307);
}
