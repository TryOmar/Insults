import WebSocket from "ws";
import axios from "axios";
import { config, headers, validateConfig } from './shared.js';

async function restartServer() {
  console.log("🔄 Restarting server...");
  
  try {
    validateConfig();
    
    console.log("🔄 Fetching WebSocket token...");
    const response = await axios.get(config.websocket.url, { headers });
    const { token, socket } = response.data.data;

    console.log("✅ Got WebSocket token");

    return new Promise((resolve, reject) => {
      console.log("🔄 Connecting to WebSocket...");

      const ws = new WebSocket(socket, {
        headers: {
          Origin: config.websocket.origin,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
      });

      let restartSent = false;

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket connection timeout"));
      }, 10000);

      ws.on("open", () => {
        console.log("✅ Connected to WebSocket");
        ws.send(JSON.stringify({ event: "auth", args: [token] }));
        console.log("🔑 Sent auth token...");
      });

      ws.on("message", (msg) => {
        const data = msg.toString();
        console.log("📩", data);

        if (
          (data.includes("auth success") || data.includes("authenticated")) &&
          !restartSent
        ) {
          console.log("✅ Authenticated, sending restart...");
          ws.send(JSON.stringify({ event: "set state", args: ["restart"] }));
          restartSent = true;

          setTimeout(() => {
            clearTimeout(timeout);
            ws.close();
            resolve(true);
          }, 1000);
        }
      });

      ws.on("close", () => {
        console.log("❌ WebSocket connection closed");
        clearTimeout(timeout);
        restartSent ? resolve(true) : reject(new Error("Restart not sent"));
      });

      ws.on("error", (err) => {
        console.error("⚠️ WebSocket Error:", err);
        clearTimeout(timeout);
        reject(err);
      });
    });
  } catch (err) {
    console.error("❌ Failed to restart server:", err.message);
    throw err;
  }
}

// Allow running directly: node scripts/restart-server.js
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1].includes('restart-server.js')) {
  console.log("🚀 Starting server restart...");
  restartServer().then(() => {
    console.log("🎉 Server restart completed successfully!");
  }).catch((err) => {
    console.error("❌ Server restart failed:", err.message);
    process.exit(1);
  });
}

export { restartServer };
