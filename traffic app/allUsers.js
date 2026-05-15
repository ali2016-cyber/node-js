const { users } = require("./server.js")

const allUsers = [...users.entries()].map(([id, u]) => ({
      id, lat: u.lat, lng: u.lng
    }));