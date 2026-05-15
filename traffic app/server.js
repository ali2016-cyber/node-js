const { getDistance } = require("./getDistance");
const { io, app, httpServer } = require("./ServerCreat");




// ─── In-memory user store ─────────────────────────────────────
const users = new Map(); // id → { lat, lng, speed, socket }
const lastPositions = new Map(); // dernières positions connues (avec timestamp)

// ─── Socket Events ────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(` User connected [${socket.id}] — total: ${users.size + 1}`);

  // Send existing users snapshot to the new client
  const snapshot = [...users.entries()].map(([id, u]) => ({
    id, lat: u.lat, lng: u.lng
  }));
  socket.emit("update", snapshot);

  // Handle position update from a client
  socket.on("positionUpdate", (data) => {
    if (!data || data.lat == null || data.lng == null || !data.id) return;

    // Store position + speed + heading
    users.set(data.id, {
      lat:    data.lat,
      lng:    data.lng,
      speed:  data.speed   || 0,
      socket
    });

    lastPositions.set(data.id, {
    lat:       data.lat,
    lng:       data.lng,
    speed:     data.speed || 0,
    timestamp: Date.now()  // moment de la dernière position connue
  });

    console.log(`📍 ${data.id} → (${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}) speed: ${(data.speed || 0).toFixed(1)} m/s`);

    // Check proximity with all other users
    let dangerDetected = false;
    let dangerDetected_5k = false;

    for (const [otherId, other] of users) {
      if (otherId === data.id) continue;

      const dist = getDistance(data.lat, data.lng, other.lat, other.lng);

      if (dist < 5000) {

        // if the distance is less than 100m
        if (dist < 100) {
          dangerDetected = true;

          // Send warning to ME with the OTHER car's data
          socket.emit("warning", {
            distance:   dist,
            otherLat:   other.lat,
            otherLng:   other.lng,
            otherSpeed: other.speed || 0
          });

          // Send warning to OTHER with MY data
          other.socket.emit("warning", {
            distance:   dist,
            otherLat:   data.lat,
            otherLng:   data.lng,
            otherSpeed: data.speed || 0
          });
        }else{
          // if the distance is less than 5km
          dangerDetected_5k = true;

          // Send warning to ME with the OTHER car's data
          socket.emit("warning-5k", {
            distance:   dist,
            otherLat:   other.lat,
            otherLng:   other.lng,
            otherSpeed: other.speed || 0
          });

          // Send warning to OTHER with MY data
          other.socket.emit("warning-5k", {
            distance:   dist,
            otherLat:   data.lat,
            otherLng:   data.lng,
            otherSpeed: data.speed || 0
          });
        }

        
      }
    }

    // Send safe message to this client (clears the notification)
    if (!dangerDetected_5k) {
      socket.emit("safe");

    }else if (!dangerDetected) {
      socket.emit("safe-5k");
      
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

  socket.on('requestOfflineWarnings', (myPosition) => {
  const FIVE_MINUTES = 5 * 60 * 1000;
  const now = Date.now();

  const recentOffline = [...lastPositions.entries()]
    .filter(([id, pos]) => {
      const isOffline = !users.has(id);
      const isRecent  = (now - pos.timestamp) < FIVE_MINUTES;

      // ← vérifier la distance côté serveur maintenant
      const dist = getDistance(
        myPosition.lat, myPosition.lng,
        pos.lat, pos.lng
      );
      const isClose = dist < 5000; // moins de 5km

      return isOffline && isRecent && isClose; // ← trois conditions
    })
    .map(([id, pos]) => ({
      id,
      lat:       pos.lat,
      lng:       pos.lng,
      timestamp: pos.timestamp,
      offline:   true,
      distance:  getDistance(myPosition.lat, myPosition.lng, pos.lat, pos.lng)
    }));

  if (recentOffline.length > 0) {
    socket.emit("offline-warning", recentOffline);
    console.log(`📡 Envoi ${recentOffline.length} positions offline proches`);
  }
});
});
setInterval(() => {
  const TEN_MINUTES = 10 * 60 * 1000;
  const now = Date.now();

  for (const [id, pos] of lastPositions) {
    if (now - pos.timestamp > TEN_MINUTES) {
      lastPositions.delete(id);
      console.log(`🗑️ Position expirée supprimée: ${id}`);
    }
  }
}, 60 * 1000); // vérifier chaque minute

// ─── Health check ─────────────────────────────────────────────
app.get("/", (req, res) => res.send("Traffic server is running "));

// ─── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports  = { users, httpServer, app };