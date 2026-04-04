const express = require("express");
const { Server } = require("socket.io");
const path = require("path");
const http = require("http");
const https = require("https");
const selfsigned = require("selfsigned");
const os = require("os");

// ─── App Setup ────────────────────────────────────────────────
const app = express();

// Serve the 'assets' folder at the root URL
//app.use(express.static(path.join(__dirname, "assets")));

// ─── Generate Self-Signed Certificate ─────────────────────────
const attrs = [{ name: "commonName", value: "localhost" }];
const pems = selfsigned.generate(attrs, { days: 365 });

// ─── HTTP Server (port 3000) ───────────────────────────────────
const httpServer = http.createServer(app);

// ─── HTTPS Server (port 3443) ─────────────────────────────────
const httpsServer = https.createServer(
  { key: pems.private, cert: pems.cert },
  app
);

// ─── Socket.IO on BOTH servers ────────────────────────────────
const io = new Server({
  cors: {
    origin: "*", 
    methods: ["GET", "POST"],
    credentials: true // Add this
  },
  allowEIO3: true // This helps if there is a version mismatch
});
io.attach(httpServer);
io.attach(httpsServer);

// ─── In-memory user store ─────────────────────────────────────
const users = new Map(); // id → { lat, lng, socket }

// ─── Haversine distance (meters) ──────────────────────────────
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── Socket Events ────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`✅ User connected [${socket.id}] — total: ${users.size + 1}`);

  // Send existing users to the newly connected client
  const snapshot = [...users.entries()].map(([id, u]) => ({ id, lat: u.lat, lng: u.lng }));
  socket.emit("update", snapshot);

  // Handle location update from a client
  socket.on("positionUpdate", (data) => {
    if (!data || data.lat == null || data.lng == null || !data.id) return;

    users.set(data.id, { lat: data.lat, lng: data.lng, socket });

    console.log(`📍 ${data.id} → (${data.lat.toFixed(5)}, ${data.lng.toFixed(5)})`);

    // Check proximity with all other users
    for (const [otherId, other] of users) {
      if (otherId === data.id) continue;
      const dist = getDistance(data.lat, data.lng, other.lat, other.lng);
      if (dist < 100) {
        const warning = { message: "سيارة قريبة!", distance: dist };
        socket.emit("warning", warning);
        other.socket.emit("warning", warning);
      }
    }

    // Broadcast all positions to every connected client
    const allUsers = [...users.entries()].map(([id, u]) => ({ id, lat: u.lat, lng: u.lng }));
    io.emit("update", allUsers);
  });

  // Clean up when user disconnects
  socket.on("disconnect", () => {
    for (const [id, user] of users) {
      if (user.socket === socket) {
        users.delete(id);
        console.log(`❌ ${id} disconnected — remaining: ${users.size}`);

        // Notify others that this user left
        const allUsers = [...users.entries()].map(([uid, u]) => ({ id: uid, lat: u.lat, lng: u.lng }));
        io.emit("update", allUsers);
        break;
      }
    }
  });
});

// ─── Get local IP ─────────────────────────────────────────────
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "your-ip";
}

// ─── Start Servers ────────────────────────────────────────────
const HTTP_PORT = 3000;
const HTTPS_PORT = 3443;
const ip = getLocalIP();

httpServer.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Server running!`);
  console.log(`   HTTP  (PC only):  http://localhost:${HTTP_PORT}/map.html`);
  console.log(`   HTTP  (network):  http://${ip}:${HTTP_PORT}/map.html`);
});

httpsServer.listen(HTTPS_PORT, "0.0.0.0", () => {
  console.log(`   HTTPS (phone ✅): https://${ip}:${HTTPS_PORT}/map.html`);
  console.log(`\n⚠️  On phone: accept the self-signed certificate warning to continue.\n`);
});
