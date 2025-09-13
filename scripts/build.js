import { exec } from "child_process";
import { promisify } from "util";

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

// Allow running directly: node scripts/build.js
if (import.meta.url === `file://${process.argv[1]}`) {
  buildProject().then(success => {
    process.exit(success ? 0 : 1);
  });
}

export { buildProject };
