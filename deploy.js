import { exec } from "child_process";
import { promisify } from "util";
import { uploadDistFolder } from './scripts/upload.js';
import { registerCommands } from './scripts/register-commands.js';
import { restartServer } from './scripts/restart-server.js';

const execAsync = promisify(exec);

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

async function deploy() {
  console.log("🚀 Starting deployment process...");
  try {
    const buildSuccess = await buildProject();
    if (!buildSuccess) throw new Error("Build failed");

    const uploadSuccess = await uploadDistFolder();
    if (!uploadSuccess) throw new Error("Upload failed");

    // Register commands after upload but before restart
    await registerCommands();

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