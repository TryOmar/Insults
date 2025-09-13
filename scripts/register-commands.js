import { spawn } from 'child_process';
import { config, validateConfig } from './shared.js';

async function registerCommands() {
  console.log("📝 Registering slash commands...");
  
  try {
    validateConfig();
    
    return new Promise((resolve, reject) => {
      const child = spawn('node', ['dist/utils/registerCommands.js'], {
        stdio: 'inherit',
        env: { ...process.env, REGISTER_COMMANDS: 'true' }
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          console.log("✅ Commands registered successfully");
          resolve(true);
        } else {
          console.error(`❌ Command registration failed with code ${code}`);
          reject(new Error(`Command registration failed with code ${code}`));
        }
      });
      
      child.on('error', (err) => {
        console.error("❌ Failed to register commands:", err.message);
        reject(err);
      });
    });
  } catch (err) {
    console.error("❌ Failed to register commands:", err.message);
    throw err;
  }
}

// Allow running directly: node scripts/register-commands.js
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1].includes('register-commands.js')) {
  console.log("🚀 Starting command registration...");
  registerCommands().then(() => {
    console.log("🎉 Command registration completed successfully!");
  }).catch((err) => {
    console.error("❌ Command registration failed:", err.message);
    process.exit(1);
  });
}

export { registerCommands };
