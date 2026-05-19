# Prudent AI Hero Quiz — v2 (updated)

## Run

1. Double-click `start_prudent_hero_server.command` (it'll prompt for your OpenAI key without saving it).
2. Open `http://127.0.0.1:8787/`.

Use the local URL instead of opening `index.html` directly — camera capture is more reliable on localhost, and OpenAI requests stay behind the local proxy.

## Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `OPENAI_API_KEY` | Selfie → superhero image generation (`/api/generate-hero`, `/api/prewarm-heroes`) | Without this, the quiz still runs but no AI hero is generated. |
| `RESEND_API_KEY` | Emailing the hero card from `/api/email-card` | Without this, the email endpoint logs to console and the UI shows a "captured" state. |
| `EMAIL_FROM` | Optional. Sender header for outbound email. | Defaults to `Prudent AI Hero <hero@resend.dev>` (Resend's test domain). Set a verified domain for prod. |
| `EMAIL_REPLY_TO` | Optional. Reply-To header. | |
| `PORT` | Optional. Defaults to `8787`. | |

Example start with everything wired:

```bash
OPENAI_API_KEY=sk-... \
RESEND_API_KEY=re_... \
EMAIL_FROM="Prudent AI <hero@yourdomain.com>" \
node prudent_hero_server.mjs
```

## What's new in this version

- **Selfie → archetype-matched superhero portrait.** The captured face is used as the identity reference for OpenAI image edit. Gender presentation (feminine / masculine / androgynous) is detected from visible cues only and used to render a body-matched suit. Identity, ethnicity, and other attributes are never inferred.
- **"Get your superhero card" CTA on the reveal overlay** replaces the previous close button — it dismisses the overlay and focuses the email field on the result panel. Escape still closes.
- **Title copy** on the reveal overlay now reads "Your Hero Archetype is".
- **Live camera preview hardened.** The video element now plays via `loadedmetadata`, surfaces status messages ("Pose for the camera, then tap Capture", "Camera access denied", etc.), and you can tap the preview to retry play if a browser blocks autoplay.
- **Print/hard-copy option removed.** Only the email-the-card flow remains on the result panel.
- **`/api/email-card` endpoint** sends a branded HTML email with the AI-generated hero image attached inline (cid) via Resend. Falls back to console-logged capture if `RESEND_API_KEY` is not set.

## Email delivery options

### Recommended: Resend (built-in)
Set `RESEND_API_KEY` and (for production) `EMAIL_FROM` to a verified domain. Free tier: 100 emails/day, 3,000/month. No code changes needed — already wired.

### Alternative: route through Clay / Zapier / Make
Set `LEAD_WEBHOOK` near the top of the `<script>` block in `index.html` to your webhook URL. Each card submission is POSTed to both `/api/email-card` (for direct send) and the webhook (for downstream automation — Clay → routing to AE → personalized email). Leaves the in-app email send as a safety net.

### Alternative: SendGrid / Postmark / SMTP
Replace `sendCardEmail()` in `prudent_hero_server.mjs` with the provider of your choice. The function receives a normalized payload — drop in the provider's SDK call and you're done.

## File map

- `index.html` — quiz app + result UI.
- `prudent_hero_server.mjs` — local static server, OpenAI image proxy, email endpoint.
- `prudent_hero_quiz_assets/` — fallback archetype illustrations + Prudent diamond mark used as the chest emblem.
- `start_prudent_hero_server.command` — launcher that prompts for `OPENAI_API_KEY` without saving it in source.
