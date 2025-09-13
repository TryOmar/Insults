import Client from "ssh2-sftp-client";
import fs from "fs";
import { config, validateConfig } from './shared.js';

async function uploadDistFolder() {
  console.log("📤 Uploading dist folder...");
  
  let sftp = null;
  
  try {
    validateConfig();
    
    sftp = new Client();
    
    console.log("🔌 Connecting to SFTP...");
    await sftp.connect(config.sftp);

    const localDistPath = "./dist";
    const remoteDistPath = "/dist";

    if (!fs.existsSync(localDistPath)) {
      throw new Error("Local dist folder not found. Run build first.");
    }

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
    if (sftp) {
      sftp.end();
      console.log("🔒 SFTP Connection closed");
    }
  }
}

// Allow running directly: node scripts/upload.js
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1].includes('upload.js')) {
  console.log("🚀 Starting upload process...");
  uploadDistFolder().then(success => {
    if (success) {
      console.log("🎉 Upload completed successfully!");
    } else {
      console.log("❌ Upload failed!");
    }
    process.exit(success ? 0 : 1);
  }).catch((err) => {
    console.error("❌ Upload failed:", err.message);
    process.exit(1);
  });
}

export { uploadDistFolder };
