const express = require("express");
const { Server } = require("socket.io");
const http = require("http");

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true
});

// ─── In-memory user store ─────────────────────────────────────
const users = new Map(); // id → { lat, lng, speed, socket }

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

  // Send existing users snapshot to the new client
  const snapshot = [...users.entries()].map(([id, u]) => ({
    id, lat: u.lat, lng: u.lng
  }));
  socket.emit("update", snapshot);

  // Handle position update from a client
  socket.on("positionUpdate", (data) => {
    if (!data || data.lat == null || data.lng == null || !data.id) return;

    // Store position + speed
    users.set(data.id, {
      lat:    data.lat,
      lng:    data.lng,
      speed:  data.speed   || 0,
      socket
    });

    console.log(`📍 ${data.id} → (${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}) speed: ${(data.speed || 0).toFixed(1)} m/s`);

    // Check proximity with all other users
    let dangerDetected = false;

    for (const [otherId, other] of users) {
      if (otherId === data.id) continue;

      const dist = getDistance(data.lat, data.lng, other.lat, other.lng);

      if (dist < 100) {
        dangerDetected = true;

        // ✅ Send warning to ME with the OTHER car's data
        socket.emit("warning", {
          distance:   dist,
          otherLat:   other.lat,
          otherLng:   other.lng,
          otherSpeed: other.speed || 0
        });

        // ✅ Send warning to OTHER with MY data
        other.socket.emit("warning", {
          distance:   dist,
          otherLat:   data.lat,
          otherLng:   data.lng,
          otherSpeed: data.speed || 0
        });
      }
    }

    // ✅ Tell this client they are safe (clears the notification)
    if (!dangerDetected) {
      socket.emit("safe");
    }

    // Broadcast all positions to every client
    const allUsers = [...users.entries()].map(([id, u]) => ({
      id, lat: u.lat, lng: u.lng
    }));
    io.emit("update", allUsers);
  });

  // Clean up on disconnect
  socket.on("disconnect", () => {
    for (const [id, user] of users) {
      if (user.socket === socket) {
        users.delete(id);
        console.log(`❌ ${id} disconnected — remaining: ${users.size}`);
        const allUsers = [...users.entries()].map(([uid, u]) => ({
          id: uid, lat: u.lat, lng: u.lng
        }));
        io.emit("update", allUsers);
        break;
      }
    }
  });
});

// ─── Health check ─────────────────────────────────────────────
app.get("/", (req, res) => res.send("Traffic server is running ✅"));

// ─── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});