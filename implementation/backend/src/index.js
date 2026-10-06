const express = require("express");
const cors = require("cors");
const config = require("./config");

const authRoutes = require("./routes/auth");
const recordRoutes = require("./routes/records");
const consentRoutes = require("./routes/consent");
const accessRoutes = require("./routes/access");
const emergencyRoutes = require("./routes/emergency");
const auditRoutes = require("./routes/audit");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/auth", authRoutes);
app.use("/records", recordRoutes);
app.use("/consent", consentRoutes);
app.use("/access", accessRoutes);
app.use("/emergency", emergencyRoutes);
app.use("/audit", auditRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`CareChain backend listening on http://localhost:${config.port}`);
  console.log(`Chain RPC: ${config.rpcUrl}`);
});
