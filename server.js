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
    res.json({ status: "Microservice running", info: "Use /api/v2/whatsapp/:sessionId/* for endpoints." });
});

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

// API Docs redirect
app.get("/api/docs", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "api-docs.html"));
});

// Setup Mount point
app.use("/api/v2", apiRoutes);

// Export the Express App for serverless (Vercel) configurations
module.exports = app;

// Listen if run directly via Node / nodemon
if (require.main === module) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`\ud83d\ude80 Multi-Session WhatsApp API Microservice running on port ${PORT}`);
        console.log(`Available Base Path: /api/v2/whatsapp/:sessionId/`);
        console.log(`Use POST /api/v2/whatsapp/your-name/start to spin up a connection.\n`);
    });
}
