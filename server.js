const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      participants: new Map(),
      streams: new Set()
    });
  }

  return rooms.get(roomId);
}

function snapshotRoom(roomId) {
  const room = getRoom(roomId);
  return {
    roomId,
    participants: Array.from(room.participants.values())
  };
}

function broadcast(roomId, event, payload) {
  const room = getRoom(roomId);
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

  for (const res of room.streams) {
    res.write(message);
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function serveFile(req, res) {
  const requestedPath = req.url === "/" ? "/index.html" : req.url;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[\/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      ".webmanifest": "application/manifest+json; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml; charset=utf-8"
    };

    const headers = {
      "Content-Type": contentTypes[ext] || "application/octet-stream"
    };

    if (path.basename(filePath) === "sw.js") {
      headers["Cache-Control"] = "no-cache";
    }

    res.writeHead(200, headers);
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error("Payload too large"));
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function validateLocation(body) {
  return Number.isFinite(body.latitude) && Number.isFinite(body.longitude);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const roomId = randomUUID().slice(0, 6).toUpperCase();
    getRoom(roomId);
    sendJson(res, 201, { roomId });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stream") {
    const roomId = (url.searchParams.get("roomId") || "").toUpperCase();

    if (!roomId) {
      sendJson(res, 400, { error: "roomId is required" });
      return;
    }

    const room = getRoom(roomId);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    res.write("\n");
    room.streams.add(res);
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshotRoom(roomId))}\n\n`);

    req.on("close", () => {
      room.streams.delete(res);
    });
    return;
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9_-]+)\/(join|leave|location|state)$/i);
  if (roomMatch) {
    const roomId = roomMatch[1].toUpperCase();
    const action = roomMatch[2].toLowerCase();
    const room = getRoom(roomId);

    if (req.method === "GET" && action === "state") {
      sendJson(res, 200, snapshotRoom(roomId));
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = await readBody(req);

      if (action === "join") {
        const userId = body.userId || randomUUID();
        const name = String(body.name || "익명").slice(0, 30).trim() || "익명";
        const color = body.color || "#1D4ED8";
        const participant = {
          userId,
          name,
          color,
          latitude: null,
          longitude: null,
          accuracy: null,
          updatedAt: null
        };
        room.participants.set(userId, participant);
        broadcast(roomId, "participant-joined", participant);
        sendJson(res, 200, { roomId, user: participant });
        return;
      }

      if (action === "leave") {
        const userId = String(body.userId || "");
        if (userId) {
          room.participants.delete(userId);
          broadcast(roomId, "participant-left", { userId });
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (action === "location") {
        if (!validateLocation(body)) {
          sendJson(res, 400, { error: "latitude and longitude are required" });
          return;
        }

        const userId = String(body.userId || "");
        const participant = room.participants.get(userId);
        if (!participant) {
          sendJson(res, 404, { error: "participant not found" });
          return;
        }

        participant.latitude = body.latitude;
        participant.longitude = body.longitude;
        participant.accuracy = Number.isFinite(body.accuracy) ? body.accuracy : null;
        participant.updatedAt = new Date().toISOString();
        room.participants.set(userId, participant);
        broadcast(roomId, "location-updated", participant);
        sendJson(res, 200, { ok: true });
        return;
      }
    } catch (error) {
      sendJson(res, error.message === "Payload too large" ? 413 : 400, { error: error.message });
      return;
    }
  }

  if (req.method === "GET") {
    serveFile(req, res);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  const printableHost = HOST === "0.0.0.0" ? "localhost / same-network IP" : HOST;
  console.log(`Live location app running at http://${printableHost}:${PORT}`);
});
