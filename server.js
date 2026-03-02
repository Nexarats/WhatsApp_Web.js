const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const apiRoutes = require("./src/routes");

const path = require("path");

const app = express();

// Increase JSON limit depending on base64 payloads size
app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));

// Root health check
app.get("/", (req, res) => {
    res.json({ status: "Microservice running", info: "POST to /api/whatsapp with an 'action' payload. Visit /docs for more info." });
});

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

// API Docs redirect
app.get("/docs", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "api-docs.html"));
});

// Setup Mount point
app.use("/api", apiRoutes);

// Export the Express App for serverless (Vercel) configurations
module.exports = app;

// Listen if run directly via Node / nodemon
if (require.main === module) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`\ud83d\ude80 Multi-Session WhatsApp API Microservice running on port ${PORT}`);
        console.log(`🚀 Docs Available at: http://localhost:${PORT}/docs`);
        console.log(`-----------------------------------------------------`);
        console.log(`Unified Endpoint:  POST /api/whatsapp`);
        console.log(`Send JSON Payload: { "action": "start", "sessionId": "default" }`);
        console.log(`-----------------------------------------------------\n`);
    });
}
