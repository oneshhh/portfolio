const { get, list, put } = require("@vercel/blob");
const { randomUUID } = require("node:crypto");

const SCORE_PREFIX = "deploy-dash/scores/";
const MAX_LEADERBOARD_SCORES = 50;

module.exports = async function handler(request, response) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return sendJson(response, 503, {
      error: "Leaderboard storage is not configured. Create a Vercel Blob store for this project."
    });
  }

  if (request.method === "GET") {
    try {
      return sendJson(response, 200, { scores: await readScores() });
    } catch (error) {
      console.error("Unable to read Deploy Dash scores:", error);
      return sendJson(response, 500, { error: "Unable to load the leaderboard." });
    }
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return sendJson(response, 405, { error: "Method not allowed" });
  }

  try {
    const body = await readJsonBody(request);
    const name = sanitizeName(body.name);
    const score = Number(body.score);
    if (!name || !Number.isInteger(score) || score < 0 || score > 10000000) {
      return sendJson(response, 400, { error: "A valid runner name and score are required." });
    }

    const entry = { name, score, playedAt: new Date().toISOString() };
    const scores = await readScores();
    await put(`${SCORE_PREFIX}${Date.now()}-${randomUUID()}.json`, JSON.stringify(entry), {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
      cacheControlMaxAge: 60
    });

    return sendJson(response, 201, {
      scores: sortScores([...scores, entry]).slice(0, 8)
    });
  } catch (error) {
    console.error("Unable to save Deploy Dash score:", error);
    return sendJson(response, 500, { error: "Unable to save the score." });
  }
};

async function readScores() {
  const { blobs } = await list({ prefix: SCORE_PREFIX, limit: 1000 });
  const entries = await Promise.all(blobs.map(readScoreEntry));
  return sortScores(entries.filter(Boolean)).slice(0, MAX_LEADERBOARD_SCORES);
}

async function readScoreEntry(blob) {
  try {
    const result = await get(blob.url, { access: "private" });
    if (!result) return null;
    const parsed = JSON.parse(await new Response(result.stream).text());
    return isValidScore(parsed) ? parsed : null;
  } catch (error) {
    console.warn(`Ignoring unreadable score entry: ${blob.pathname}`);
    return null;
  }
}

function sortScores(scores) {
  return [...scores].sort((left, right) => right.score - left.score || left.playedAt.localeCompare(right.playedAt));
}

function isValidScore(entry) {
  return entry && sanitizeName(entry.name) && Number.isInteger(entry.score) && entry.score >= 0 && typeof entry.playedAt === "string";
}

function sanitizeName(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").replace(/[^a-zA-Z0-9 _.-]/g, "").slice(0, 20);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch { reject(new Error("Invalid JSON")); }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.status(statusCode).json(payload);
}
