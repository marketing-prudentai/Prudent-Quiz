import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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

function dataUrlToFile(dataUrl) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
  if (!match) throw new Error("Expected a base64 image data URL.");
  const mimeType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const bytes = Buffer.from(match[2], "base64");
  return new File([bytes], "camera-reference.jpg", { type: mimeType });
}

async function loadCardTemplate() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../prudent_hero_quiz_assets/The_Risk.png"),
    path.resolve(here, "prudent_hero_quiz_assets/The_Risk.png"),
    path.resolve(process.cwd(), "prudent_hero_quiz_assets/The_Risk.png"),
  ];
  for (const p of candidates) {
    try {
      const bytes = await readFile(p);
      return new File([bytes], "The_Risk.png", { type: "image/png" });
    } catch {}
  }
  throw new Error("Card template asset not found in bundle.");
}

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!OPENAI_API_KEY) {
    return json({ error: "OPENAI_API_KEY is not set in Netlify env vars." }, 500);
  }

  try {
    const body = await request.json();
    if (!body?.image || typeof body.image !== "string" || !body.image.startsWith("data:image/")) {
      return json({ error: "Captured selfie missing or invalid." }, 400);
    }

    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("image[]", dataUrlToFile(body.image));
    form.append("image[]", await loadCardTemplate());
    form.append("prompt", "replace this new person image in that existing card in the same design style , theme and give me.");
    form.append("size", "1024x1024");
    form.append("quality", "low");
    form.append("output_format", "png");
    form.append("input_fidelity", "high");

    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
    const result = await r.json();
    if (!r.ok) {
      return json({ error: result?.error?.message || `OpenAI returned ${r.status}` }, 500);
    }
    const first = result?.data?.[0];
    const imageDataUrl = first?.b64_json
      ? `data:image/png;base64,${first.b64_json}`
      : (first?.url || "");
    if (!imageDataUrl) return json({ error: "No image returned." }, 500);
    return json({ imageDataUrl });
  } catch (err) {
    return json({ error: err.message || "Unexpected error" }, 500);
  }
};

export const config = { path: "/.netlify/functions/generate-card" };
