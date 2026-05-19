const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "Prudent AI Hero <hero@resend.dev>";
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[c]);
}

function buildEmailHtml(payload) {
  const name = escapeHtml(payload.heroName || "Your Hero Archetype");
  const tag = escapeHtml(payload.heroTag || "");
  const move = escapeHtml(payload.heroMove || "");
  const layer = escapeHtml(payload.heroLayer || "");
  const axis = escapeHtml(payload.heroAxis || "");
  const heroImageTag = payload.heroImageDataUrl
    ? `<img src="cid:hero-card" alt="${name}" style="width:100%;max-width:520px;border-radius:18px;display:block;margin:0 auto 24px;" />`
    : (payload.heroImageUrl
      ? `<img src="${escapeHtml(payload.heroImageUrl)}" alt="${name}" style="width:100%;max-width:520px;border-radius:18px;display:block;margin:0 auto 24px;" />`
      : "");
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="color-scheme" content="dark only" /></head>
<body style="margin:0;background:#0a0410;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:#f4ecff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0410;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:linear-gradient(180deg,#1a0a32 0%,#0a0410 100%);border-radius:24px;padding:28px;border:1px solid rgba(157,108,255,0.28);">
        <tr><td>
          <p style="margin:0 0 8px;color:#b996ff;font-size:11px;font-weight:900;letter-spacing:.2em;text-transform:uppercase;">Your Hero Archetype</p>
          <h1 style="margin:0 0 4px;color:#fff8ff;font-size:34px;line-height:1.05;letter-spacing:-0.5px;">${name}</h1>
          ${axis ? `<p style="margin:0 0 22px;color:#d8a7ff;font-size:13px;letter-spacing:.18em;text-transform:uppercase;font-weight:800;">Top match · ${axis}</p>` : ""}
          ${heroImageTag}
          ${tag ? `<p style="margin:0 0 18px;color:#f4ecff;font-size:18px;line-height:1.4;">${tag}</p>` : ""}
          ${move ? `<p style="margin:0 0 6px;color:#b996ff;font-size:11px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;">Signature move</p><p style="margin:0 0 18px;color:#f4ecff;font-size:15px;line-height:1.5;">${move}</p>` : ""}
          ${layer ? `<p style="margin:0 0 6px;color:#b996ff;font-size:11px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;">Why this matters</p><p style="margin:0 0 24px;color:#f4ecff;font-size:15px;line-height:1.5;">${layer}</p>` : ""}
          <a href="https://prudent.ai" style="display:inline-block;padding:14px 26px;background:linear-gradient(135deg,#9d6cff,#fff8ff);color:#1c0a3a;font-weight:900;font-size:15px;text-decoration:none;border-radius:999px;">See Prudent AI in action</a>
          <p style="margin:28px 0 0;color:#8a82a3;font-size:12px;line-height:1.5;">Prudent AI · The Upfront Decisioning Layer</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  try {
    const body = await request.json();
    if (!body?.email || !/.+@.+\..+/.test(body.email)) {
      return json({ error: "Valid email required." }, 400);
    }
    if (!RESEND_API_KEY) {
      console.log("[email-card — no RESEND_API_KEY, logging only]", {
        email: body.email, hero: body.heroName, heroKey: body.heroKey, axis: body.heroAxis,
      });
      return json({ ok: true, mode: "logged" });
    }
    const html = buildEmailHtml(body);
    const attachments = [];
    if (body.heroImageDataUrl) {
      const match = body.heroImageDataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
      if (match) {
        attachments.push({
          filename: `${(body.heroName || "your-hero").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`,
          content: match[2],
          content_id: "hero-card",
        });
      }
    }
    const payload = {
      from: EMAIL_FROM,
      to: [body.email],
      subject: `Your Hero Archetype: ${body.heroName || "Prudent AI"}`,
      html,
    };
    if (attachments.length) payload.attachments = attachments;
    if (EMAIL_REPLY_TO) payload.reply_to = EMAIL_REPLY_TO;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json({ error: data?.message || data?.error?.message || `Resend ${r.status}` }, 500);
    }
    return json({ ok: true, mode: "sent", id: data.id });
  } catch (err) {
    return json({ error: err.message || "Email send failed." }, 500);
  }
};

export const config = { path: "/.netlify/functions/email-card" };
