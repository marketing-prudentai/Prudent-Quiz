import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "Prudent AI Hero <hero@resend.dev>";
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || "";
const STATIC_DIR = process.env.STATIC_DIR || SCRIPT_DIR;
const DIAMOND_MARK_PATH = path.join(STATIC_DIR, "prudent_hero_quiz_assets", "prudent-diamond-mark.png");
const CARD_TEMPLATE_PATH = path.join(STATIC_DIR, "prudent_hero_quiz_assets", "The_Risk.png");
const jobs = new Map();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    ...corsHeaders,
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify(payload));
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

async function sendStatic(res, pathname) {
  const cleanPath = decodeURIComponent(pathname).replace(/^\/+/, "");
  const relativePath = cleanPath || "index.html";
  if (relativePath.includes("..")) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }
  const filePath = path.join(STATIC_DIR, relativePath);
  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      ...corsHeaders,
      "Content-Type": contentType(filePath),
    });
    res.end(file);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function dataUrlToFile(dataUrl) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
  if (!match) throw new Error("Expected a base64 image data URL.");
  const mimeType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const bytes = Buffer.from(match[2], "base64");
  return new File([bytes], "camera-reference.jpg", { type: mimeType });
}

async function diamondMarkToFile() {
  const bytes = await readFile(DIAMOND_MARK_PATH);
  return new File([bytes], "prudent-diamond-mark.png", { type: "image/png" });
}

async function cardTemplateToFile() {
  const bytes = await readFile(CARD_TEMPLATE_PATH);
  return new File([bytes], "The_Risk.png", { type: "image/png" });
}

async function generateCard({ image }) {
  if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
    throw new Error("Captured selfie missing or invalid — expected a data:image/* URL.");
  }
  const selfieFile = dataUrlToFile(image);
  const templateFile = await cardTemplateToFile();
  console.log(`[generate-card] selfie=${selfieFile.size}B template=${templateFile.size}B`);

  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("image[]", selfieFile);
  form.append("image[]", templateFile);
  form.append("prompt", "replace this new person image in that existing card in the same design style , theme and give me.");
  form.append("size", "1024x1024");
  form.append("quality", "low");
  form.append("output_format", "png");
  form.append("input_fidelity", "high");

  const openaiResponse = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });

  const result = await openaiResponse.json();
  if (!openaiResponse.ok) {
    console.error("[generate-card] OpenAI error:", openaiResponse.status, result);
    throw new Error(result?.error?.message || `OpenAI returned ${openaiResponse.status}.`);
  }

  const imageResult = imageFromOpenAIResult(result);
  if (!imageResult) throw new Error("OpenAI response did not include an image.");
  return imageResult;
}

function compactAppearanceProfile(profile) {
  if (!profile || typeof profile !== "object") return "";
  return [
    profile.hair,
    profile.facialHair,
    profile.glasses,
    profile.skinTone,
    profile.faceShape,
    profile.expression,
    profile.visibleAccessories,
    profile.bodyPresentation,
    profile.distinguishingFeatures,
  ].filter(Boolean).join(" ");
}

// Maps a gender-presentation guess to concrete suit/body direction the image model can act on.
function suitDirectionFor(presentation) {
  const p = (presentation || "").toLowerCase();
  if (p.includes("femin")) {
    return "Body and suit: render a feminine-presenting superhero — a tailored female-fit superhero suit with a feminine silhouette and proportions matched to the reference person. Hair length and style as shown in the reference.";
  }
  if (p.includes("masc")) {
    return "Body and suit: render a masculine-presenting superhero — a structured male-fit superhero suit with a broader-shouldered masculine silhouette and proportions matched to the reference person. Hair length and style as shown in the reference.";
  }
  return "Body and suit: render a superhero suit and silhouette that visually match the gender presentation shown in the reference photo. Do not change the person's apparent presentation.";
}

async function analyzeReferenceAppearance(image) {
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Describe only visible appearance details that should remain unchanged when turning this person into a superhero portrait.",
                "Do not guess identity or ethnicity.",
                "Estimate apparent gender presentation (one of: feminine, masculine, androgynous) from visible cues only — this is used purely to render a body-matched superhero suit, not to label the person.",
                "Return compact JSON with these exact keys:",
                "hair, facialHair, glasses, skinTone, faceShape, expression, visibleAccessories, bodyPresentation, distinguishingFeatures, genderPresentation.",
                "Use short concrete descriptions. If a detail is not visible, use an empty string. genderPresentation must be one of: feminine, masculine, androgynous.",
              ].join(" "),
            },
            { type: "input_image", image_url: image },
          ],
        }],
        text: { format: { type: "json_object" } },
      }),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result?.error?.message || "Appearance analysis failed.");
    const raw = result.output_text || "";
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildPrompt({ archetype, axis, prompt, appearanceProfile }) {
  const appearanceLock = compactAppearanceProfile(appearanceProfile);
  const suitDirection = suitDirectionFor(appearanceProfile?.genderPresentation);
  return [
    prompt,
    "",
    `Archetype: ${archetype || "Prudent AI mortgage superhero"}.`,
    axis ? `Decision style: ${axis}.` : "",
    "Identity lock: preserve the person from the uploaded photo. Keep the same face, eyes, nose, mouth, jaw, skin tone, age, expression, hairline, and facial proportions.",
    appearanceLock ? `Visible-trait lock: ${appearanceLock}` : "",
    suitDirection,
    "Preserve every visible trait from the reference photo: hair length, hairstyle, facial hair, glasses, skin tone, expression, visible accessories, and distinguishing details. Do not replace, shorten, lengthen, remove, or invent those traits.",
    "Allowed changes: wardrobe, lighting, pose, and environment only. Keep the person recognizable at first glance.",
    "Art direction: premium phone-wallpaper portrait, person-first composition, cinematic plum-to-violet gradients, luminous electric-purple rim light, soft white-magenta energy arcs, subtle nebula haze, rich purple atmosphere, realistic skin texture, crisp eyes, elegant glossy superhero suit, emotionally aspirational and download-worthy.",
    "Composition: vertical 2:3 portrait, face and person are the clear focus, three-quarter hero framing, generous dark-violet breathing room above the head, full silhouette readable, background supports the person instead of overpowering them.",
    "Brand emblem: use only the exact purple diamond mark from the second reference image as a tasteful chest emblem or suit badge. No wordmark, no Prudent text, no letters, no alternate logo, no extra symbols.",
    "Avoid: face swap, younger/older version, hairstyle changes, facial-hair changes, accessory removal, exaggerated beauty retouching, distorted facial geometry, generic comic-book look, text, watermark, logos other than the supplied diamond mark, cropped head, mismatched body type or wrong-presentation suit.",
  ].filter(Boolean).join("\n");
}

function imageFromOpenAIResult(result) {
  const first = result?.data?.[0];
  if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`;
  if (first?.url) return first.url;
  return "";
}

async function generateHero({ image, archetype, axis, prompt, appearanceProfile }) {
  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("image[]", dataUrlToFile(image));
  form.append("image[]", await diamondMarkToFile());
  form.append("prompt", buildPrompt({ archetype, axis, prompt, appearanceProfile }));
  form.append("size", "1024x1536");
  form.append("quality", "high");
  form.append("output_format", "png");

  const openaiResponse = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });

  const result = await openaiResponse.json();
  if (!openaiResponse.ok) {
    throw new Error(result?.error?.message || "OpenAI image generation failed.");
  }

  const imageResult = imageFromOpenAIResult(result);
  if (!imageResult) throw new Error("OpenAI response did not include an image.");
  return imageResult;
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

async function sendCardEmail(payload) {
  if (!RESEND_API_KEY) {
    return { ok: true, mode: "logged" };
  }
  const html = buildEmailHtml(payload);
  const attachments = [];
  if (payload.heroImageDataUrl) {
    const match = payload.heroImageDataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
    if (match) {
      attachments.push({
        filename: `${(payload.heroName || "your-hero").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`,
        content: match[2],
        content_id: "hero-card",
      });
    }
  }
  const body = {
    from: EMAIL_FROM,
    to: [payload.email],
    subject: `Your Hero Archetype: ${payload.heroName || "Prudent AI"}`,
    html,
  };
  if (attachments.length) body.attachments = attachments;
  if (EMAIL_REPLY_TO) body.reply_to = EMAIL_REPLY_TO;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.message || data?.error?.message || `Resend ${r.status}`);
  return { ok: true, mode: "sent", id: data.id };
}

function startHeroJob(body) {
  const id = randomUUID();
  const archetypes = Array.isArray(body.archetypes) && body.archetypes.length
    ? body.archetypes
    : [{ key: "hero", name: body.archetype || "Prudent AI Hero", axis: "" }];

  const job = {
    id,
    status: "running",
    total: archetypes.length,
    completed: 0,
    images: {},
    errors: {},
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);

  (async () => {
    const appearanceProfile = await analyzeReferenceAppearance(body.image);
    await Promise.allSettled(archetypes.map(async archetype => {
      try {
        const imageUrl = await generateHero({
          image: body.image,
          archetype: archetype.name,
          axis: archetype.axis,
          prompt: body.prompt,
          appearanceProfile,
        });
        job.images[archetype.key] = imageUrl;
      } catch (error) {
        job.errors[archetype.key] = error.message || "Generation failed.";
      } finally {
        job.completed += 1;
        if (job.completed >= job.total) {
          job.status = Object.keys(job.images).length ? "complete" : "failed";
        }
      }
    }));
  })();

  return job;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

  if (url.pathname === "/api/hero-job" && req.method === "GET") {
    const job = jobs.get(url.searchParams.get("id"));
    if (!job) {
      sendJson(res, 404, { error: "Job not found." });
      return;
    }
    sendJson(res, 200, job);
    return;
  }

  if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
    await sendStatic(res, url.pathname);
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  // /api/email-card stands on its own — it doesn't need OpenAI.
  if (url.pathname === "/api/email-card") {
    try {
      const body = await readJson(req);
      if (!body || !body.email || !/.+@.+\..+/.test(body.email)) {
        sendJson(res, 400, { error: "Valid email required." });
        return;
      }
      if (!RESEND_API_KEY) {
        console.log("[email-card — no RESEND_API_KEY set, logging payload only]", {
          email: body.email, hero: body.heroName, heroKey: body.heroKey, axis: body.heroAxis,
        });
        sendJson(res, 200, { ok: true, mode: "logged" });
        return;
      }
      const result = await sendCardEmail(body);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Email send failed." });
    }
    return;
  }

  if (!OPENAI_API_KEY) {
    sendJson(res, 500, { error: "OPENAI_API_KEY is not set." });
    return;
  }

  try {
    const body = await readJson(req);

    if (url.pathname === "/api/prewarm-heroes") {
      const job = startHeroJob(body);
      sendJson(res, 202, job);
      return;
    }

    if (url.pathname === "/api/generate-hero") {
      const appearanceProfile = await analyzeReferenceAppearance(body.image);
      const imageUrl = await generateHero({ ...body, appearanceProfile });
      sendJson(res, 200, { imageDataUrl: imageUrl });
      return;
    }

    if (url.pathname === "/api/generate-card") {
      const imageUrl = await generateCard({ image: body.image });
      sendJson(res, 200, { imageDataUrl: imageUrl });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unexpected server error." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Prudent hero image server running on port ${PORT}`);
});
