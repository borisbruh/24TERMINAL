const express = require("express");

const app = express();

// Use environment-provided port (Render does this automatically)
const PORT = process.env.PORT || 3000;  // Render assigns `process.env.PORT` on deployment

// ===============================
// CACHE
// ===============================
let cachedPlanes = {};
let cachedControllers = [];

// Serve frontend (static files from 'public' folder)
app.use(express.static("public"));

// ===============================
// FETCH PLANES (every 5s)
// ===============================
async function updatePlanes() {
    try {
        const response = await fetch("https://24data.ptfs.app/acft-data");
        const data = await response.json();
        cachedPlanes = data;
        console.log("Updated plane cache");
    } catch (err) {
        console.error("Plane API error:", err);
    }
}

// Initial fetch and then set to update every 5 seconds
setInterval(updatePlanes, 5000);
updatePlanes();

// ===============================
// FETCH CONTROLLERS (every 30s)
// ===============================
async function updateControllers() {
    try {
        const response = await fetch("https://24data.ptfs.app/controllers");
        const data = await response.json();
        cachedControllers = data;
        console.log("Updated controller cache");
    } catch (err) {
        console.error("Controller API error:", err);
    }
}

// Initial fetch and then set to update every 30 seconds
setInterval(updateControllers, 30000);
updateControllers();

// ===============================
// ENDPOINTS
// ===============================
// Provide cached planes data at /api/planes
app.get("/api/planes", (req, res) => {
    res.json(cachedPlanes);
});

// Provide cached controllers data at /api/controllers
app.get("/api/controllers", (req, res) => {
    res.json(cachedControllers);
});

// Start the server, use the dynamic port
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
