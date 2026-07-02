/* ============================================================
 * server.mjs — self-hosted Guitar Co-Writer backend.
 *
 * Serves the built app (dist/) AND implements POST /cowrite using
 * the Claude Agent SDK authenticated with CLAUDE_CODE_OAUTH_TOKEN —
 * i.e. billed to a Claude Pro/Max SUBSCRIPTION, not API credits.
 * The token never leaves this server.
 *
 * Env:
 *   CLAUDE_CODE_OAUTH_TOKEN  (required for AI; `claude setup-token`)
 *   COWRITE_TOKEN            (optional bearer gate for /cowrite)
 *   PORT                     (default 8090)
 * ============================================================ */
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "dist");
const PORT = Number(process.env.PORT || 8090);
const GATE = process.env.COWRITE_TOKEN || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/** Model aliases → Claude Code model names (subscription-covered). */
const MODEL_ALIAS = {
  "claude-sonnet-4-6": "sonnet",
  "claude-opus-4-8": "opus",
  "claude-haiku-4-5": "haiku",
  "claude-fable-5": "claude-fable-5",
};

function send(res, code, body, headers = {}) {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    ...headers,
  });
  res.end(data);
}

async function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Extract the first JSON object from model text (tolerates fences/prose). */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  if (start < 0) throw new Error("no JSON in response");
  // walk to the matching close brace
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) return JSON.parse(candidate.slice(start, i + 1)); }
  }
  throw new Error("unterminated JSON in response");
}

/** One Agent SDK call: system + chat history → JSON matching schema. */
async function cowrite({ system, messages, schema, toolName, model, maxTokens }) {
  const convo = messages
    .map((m) => `${m.role === "user" ? "USER" : "YOU (previous turn)"}: ${m.content}`)
    .join("\n\n");
  const prompt =
    `${convo}\n\n` +
    `Respond by producing ONLY a JSON object (no prose, no markdown fence) that validates against ` +
    `this JSON Schema (named "${toolName}"):\n${JSON.stringify(schema)}\n`;

  const q = query({
    prompt,
    options: {
      systemPrompt: system,
      model: MODEL_ALIAS[model] || model || "sonnet",
      maxTurns: 1,
      allowedTools: [],
      permissionMode: "bypassPermissions",
      maxThinkingTokens: 0,
      ...(maxTokens ? {} : {}),
    },
  });

  let text = "";
  for await (const msg of q) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") text += block.text;
      }
    }
    if (msg.type === "result" && msg.subtype !== "success") {
      throw new Error(`agent error: ${msg.subtype}`);
    }
  }
  return extractJson(text);
}

async function serveStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/") path = "/index.html";
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { send(res, 403, { error: "forbidden" }); return; }
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error("dir");
    const data = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] || "application/octet-stream",
      "cache-control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(data);
  } catch {
    // SPA fallback
    const data = await readFile(join(ROOT, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    res.end(data);
  }
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;

  if (path === "/cowrite") {
    if (req.method === "OPTIONS") { send(res, 204, ""); return; }
    if (req.method !== "POST") { send(res, 405, { error: "POST only" }, { allow: "POST, OPTIONS" }); return; }
    if (GATE) {
      const auth = req.headers.authorization || "";
      if (auth !== `Bearer ${GATE}`) { send(res, 401, { error: "bad token" }); return; }
    }
    // No hard env gate: on macOS the Agent SDK can also find keychain
    // credentials. In the container, CLAUDE_CODE_OAUTH_TOKEN is required
    // and its absence will surface as a clear agent error below.
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.system || !Array.isArray(body.messages) || !body.schema || !body.toolName) {
        send(res, 400, { error: "missing fields (system, messages, schema, toolName)" });
        return;
      }
      let out;
      try {
        out = await cowrite(body);
      } catch (e1) {
        console.error("[cowrite] first attempt failed:", e1.message, "— retrying once");
        out = await cowrite(body); // one retry (transient / bad JSON)
      }
      send(res, 200, out);
    } catch (e) {
      console.error("[cowrite] error:", e.message);
      send(res, 502, { error: e.message });
    }
    return;
  }

  if (path === "/healthz") {
    send(res, 200, { ok: true, ai: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY) });
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") { await serveStatic(req, res); return; }
  send(res, 405, { error: "method not allowed" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[guitar-cowriter] serving dist/ + /cowrite on :${PORT}`);
  console.log(`[guitar-cowriter] AI auth: ${process.env.CLAUDE_CODE_OAUTH_TOKEN ? "subscription (OAuth token)" : process.env.ANTHROPIC_API_KEY ? "API key" : "NONE — /cowrite disabled"}`);
  console.log(`[guitar-cowriter] bearer gate: ${GATE ? "on" : "off"}`);
});
