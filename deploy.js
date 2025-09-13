import dotenv from "dotenv";
dotenv.config({ path: ".env.deploy" });

import Client from "ssh2-sftp-client";
import WebSocket from "ws";
import axios from "axios";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";

const execAsync = promisify(exec);

// SFTP Configuration
const sftpConfig = {
  host: process.env.SFTP_HOST,
  port: Number(process.env.SFTP_PORT),
  username: process.env.SFTP_USER,
  password: process.env.SFTP_PASS,
};

// WebSocket Configuration
const API_URL = process.env.DEPLOY_WS_URL;
const headers = {
  accept: "application/json",
  "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
  pragma: "no-cache",
  priority: "u=1, i",
  referer: process.env.DEPLOY_REFERER,
  "sec-ch-ua":
    '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "x-requested-with": "XMLHttpRequest",
  cookie: process.env.DEPLOY_COOKIE,
};

async function buildProject() {
  console.log("🔨 Building project...");
  try {
    const { stdout, stderr } = await execAsync("npm run build");
    if (stderr) console.log("Build warnings:", stderr);
    console.log("✅ Build completed successfully");
    return true;
  } catch (error) {
    console.error("❌ Build failed:", error.message);
    return false;
  }
}

async function uploadDistFolder() {
  const sftp = new Client();
  try {
    console.log("🔌 Connecting to SFTP...");
    await sftp.connect(sftpConfig);

    const localDistPath = "./dist";
    const remoteDistPath = "/dist";

    if (!fs.existsSync(localDistPath)) {
      throw new Error("Local dist folder not found. Run build first.");
    }

    console.log("📤 Uploading dist folder...");

    try {
      await sftp.rmdir(remoteDistPath, true);
      console.log("🗑️ Removed existing remote dist folder");
    } catch {
      // ignore if not exists
    }

    await sftp.uploadDir(localDistPath, remoteDistPath);
    console.log("✅ Dist folder uploaded successfully");
    return true;
  } catch (err) {
    console.error("⚠️ SFTP Upload Error:", err.message);
    return false;
  } finally {
    sftp.end();
    console.log("🔒 SFTP Connection closed");
  }
}

async function restartServer() {
  try {
    console.log("🔄 Fetching WebSocket token...");
    const response = await axios.get(API_URL, { headers });
    const { token, socket } = response.data.data;

    console.log("✅ Got WebSocket token");

    return new Promise((resolve, reject) => {
      console.log("🔄 Connecting to WebSocket...");

      const ws = new WebSocket(socket, {
        headers: {
          Origin: process.env.DEPLOY_ORIGIN,
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
    console.error("❌ Failed to fetch WebSocket token:", err.message);
    throw err;
  }
}

async function deploy() {
  console.log("🚀 Starting deployment process...");
  try {
    const buildSuccess = await buildProject();
    if (!buildSuccess) throw new Error("Build failed");

    const uploadSuccess = await uploadDistFolder();
    if (!uploadSuccess) throw new Error("Upload failed");

    console.log("🔄 Restarting server...");
    await restartServer();

    console.log("🎉 Deployment completed successfully!");
    console.log("✅ Your app should now be running with the latest changes");
  } catch (error) {
    console.error("❌ Deployment failed:", error.message);
    process.exit(1);
  }
}

deploy();
