const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIRECTORY = __dirname;
const SCORES_FILE = path.join(ROOT_DIRECTORY, "data", "scores.json");
const MAX_SCORES = 50;
let scoreWriteQueue = Promise.resolve();

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf"
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept"
    });
    return response.end();
  }

  if (url.pathname === "/api/scores") {
    if (request.method === "GET") {
      return sendJson(response, 200, { scores: await readScores() });
    }
    if (request.method === "POST") {
      return saveScore(request, response);
    }
    return sendJson(response, 405, { error: "Method not allowed" });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return sendText(response, 405, "Method not allowed");
  }
  return serveStatic(url.pathname, request.method, response);
});

async function saveScore(request, response) {
  try {
    const body = await readJsonBody(request);
    const nameError = validateRunnerName(body.name);
    const name = sanitizeName(body.name);
    const score = Number(body.score);
    if (nameError || !Number.isInteger(score) || score < 0 || score > 10000000) {
      return sendJson(response, 400, { error: "A valid runner name and score are required." });
    }

    scoreWriteQueue = scoreWriteQueue.then(async () => {
      const scores = await readScores();
      scores.push({ name, score, playedAt: new Date().toISOString() });
      const sortedScores = sortScores(scores).slice(0, MAX_SCORES);
      await writeScores(sortedScores);
      return sortedScores;
    });

    const scores = await scoreWriteQueue;
    return sendJson(response, 201, { scores: scores.slice(0, 8) });
  } catch (error) {
    console.error("Unable to save score:", error);
    return sendJson(response, 500, { error: "Unable to save the score." });
  }
}

async function readScores() {
  try {
    const content = await fs.readFile(SCORES_FILE, "utf8");
    const parsed = JSON.parse(content);
    const scores = Array.isArray(parsed.scores) ? parsed.scores : [];
    return sortScores(scores.filter(isValidScore)).slice(0, MAX_SCORES);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    console.error("Unable to read scores:", error);
    return [];
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

function validateRunnerName(value) {
  if (typeof value !== "string") return "invalid";
  const name = value.trim();
  if (name.length < 2 || name.length > 20 || !/^[a-zA-Z0-9 _.-]+$/.test(name)) return "invalid";
  const compactName = normalizeRunnerName(name);
  const blockedWords = ["fuck", "shit", "bitch", "cunt", "dick", "pussy", "asshole", "bastard", "whore", "slut", "porn", "sex", "nigger", "faggot", "retard"];
  return blockedWords.some((word) => compactName.includes(word)) ? "blocked" : "";
}

function normalizeRunnerName(value) {
  const substitutions = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "!": "i", "$": "s" };
  return value.toLowerCase().replace(/[013457@!$]/g, (character) => substitutions[character]).replace(/[^a-z0-9]/g, "");
}

async function writeScores(scores) {
  await fs.mkdir(path.dirname(SCORES_FILE), { recursive: true });
  const temporaryFile = `${SCORES_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify({ scores }, null, 2)}\n`, "utf8");
  await fs.rename(temporaryFile, SCORES_FILE);
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

async function serveStatic(pathname, method, response) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(ROOT_DIRECTORY, `.${decodeURIComponent(requestedPath)}`);
  if (!filePath.startsWith(`${ROOT_DIRECTORY}${path.sep}`)) {
    return sendText(response, 403, "Forbidden");
  }

  try {
    const content = await fs.readFile(filePath);
    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
    response.end(method === "HEAD" ? undefined : content);
  } catch (error) {
    sendText(response, error.code === "ENOENT" ? 404 : 500, error.code === "ENOENT" ? "Not found" : "Server error");
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(message);
}

server.listen(PORT, () => {
  console.log(`Portfolio running at http://localhost:${PORT}`);
});
