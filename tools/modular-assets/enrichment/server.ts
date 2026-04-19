/**
 * Asset Enrichment Tool — Deno HTTP Server
 *
 * Serves the Three.js viewer + form UI and provides API endpoints
 * for reading/writing enrichment metadata per asset.
 *
 * Usage: deno task asset:enrich
 */

const PROJECT_ROOT = new URL("../../..", import.meta.url).pathname.replace(
  /\/$/,
  "",
);
const GLB_DIR = `${PROJECT_ROOT}/assets/scifi_assets/glb`;
const ASSET_LIBRARY_PATH = `${PROJECT_ROOT}/data/modular/asset_library.json`;
const ENRICHMENT_PATH = `${PROJECT_ROOT}/data/modular/asset_enrichment.json`;
const HTML_PATH = new URL("./index.html", import.meta.url).pathname;
const SCREENSHOTS_DIR = `${PROJECT_ROOT}/data/modular/screenshots`;

// Ensure screenshots dir exists
try {
  await Deno.mkdir(SCREENSHOTS_DIR, { recursive: true });
} catch {
  // already exists
}

// Load or create enrichment data
interface EnrichmentEntry {
  id: string;
  visualDescription: string;
  surfaceTags: string[];
  opacity: string;
  heightCoverage: string;
  bestUsedFor: string;
  pairsWith: string[];
  gotchas: string;
  enrichedAt?: string;
}

type EnrichmentData = Record<string, EnrichmentEntry>;

async function loadEnrichment(): Promise<EnrichmentData> {
  try {
    const text = await Deno.readTextFile(ENRICHMENT_PATH);
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function saveEnrichment(data: EnrichmentData): Promise<void> {
  await Deno.writeTextFile(ENRICHMENT_PATH, JSON.stringify(data, null, 2));
}

const PORT = 8420;

function contentType(path: string): string {
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".glb")) return "model/gltf-binary";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".js")) return "application/javascript";
  if (path.endsWith(".css")) return "text/css";
  return "application/octet-stream";
}

const server = Deno.serve({ port: PORT }, async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS headers for local dev
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  // --- Routes ---

  // Root → serve HTML
  if (path === "/" || path === "/index.html") {
    const html = await Deno.readTextFile(HTML_PATH);
    headers.set("Content-Type", "text/html");
    return new Response(html, { headers });
  }

  // GET /api/assets — return asset library
  if (path === "/api/assets" && req.method === "GET") {
    const text = await Deno.readTextFile(ASSET_LIBRARY_PATH);
    headers.set("Content-Type", "application/json");
    return new Response(text, { headers });
  }

  // GET /api/enrichment — return all enrichment data
  if (path === "/api/enrichment" && req.method === "GET") {
    const data = await loadEnrichment();
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify(data), { headers });
  }

  // POST /api/enrichment/:id — save enrichment for one asset
  const enrichMatch = path.match(/^\/api\/enrichment\/(.+)$/);
  if (enrichMatch && req.method === "POST") {
    const id = decodeURIComponent(enrichMatch[1]);
    const body = await req.json();
    const data = await loadEnrichment();
    data[id] = { ...body, id, enrichedAt: new Date().toISOString() };
    await saveEnrichment(data);
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify({ ok: true }), { headers });
  }

  // POST /api/screenshot/:id — save a PNG screenshot
  const screenshotMatch = path.match(/^\/api\/screenshot\/(.+)$/);
  if (screenshotMatch && req.method === "POST") {
    const id = decodeURIComponent(screenshotMatch[1]);
    const blob = await req.arrayBuffer();
    const filePath = `${SCREENSHOTS_DIR}/${id}.png`;
    await Deno.writeFile(filePath, new Uint8Array(blob));
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify({ ok: true, path: filePath }), {
      headers,
    });
  }

  // GET /glb/:filename — serve GLB files
  const glbMatch = path.match(/^\/glb\/(.+\.glb)$/);
  if (glbMatch) {
    const filename = decodeURIComponent(glbMatch[1]);
    const filePath = `${GLB_DIR}/${filename}`;
    try {
      const data = await Deno.readFile(filePath);
      headers.set("Content-Type", "model/gltf-binary");
      return new Response(data, { headers });
    } catch {
      return new Response("Not found", { status: 404, headers });
    }
  }

  // GET /screenshots/:filename — serve screenshot PNGs
  const ssMatch = path.match(/^\/screenshots\/(.+\.png)$/);
  if (ssMatch) {
    const filename = decodeURIComponent(ssMatch[1]);
    const filePath = `${SCREENSHOTS_DIR}/${filename}`;
    try {
      const data = await Deno.readFile(filePath);
      headers.set("Content-Type", "image/png");
      return new Response(data, { headers });
    } catch {
      return new Response("Not found", { status: 404, headers });
    }
  }

  return new Response("Not found", { status: 404, headers });
});

console.log(`\n  Asset Enrichment Tool running at http://localhost:${PORT}\n`);
console.log(`  GLB directory: ${GLB_DIR}`);
console.log(`  Asset library: ${ASSET_LIBRARY_PATH}`);
console.log(`  Enrichment data: ${ENRICHMENT_PATH}`);
console.log(`  Screenshots: ${SCREENSHOTS_DIR}\n`);

// Keep process alive
await server.finished;
