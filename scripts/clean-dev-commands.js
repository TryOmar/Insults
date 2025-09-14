import { REST, Routes } from 'discord.js';
import { config } from '../dist/config.js';

async function cleanDevCommands() {
  console.log('🧹 Starting DEV command cleanup...');
  console.log(`Client ID: ${config.clientId}`);
  
  const rest = new REST({ version: '10' }).setToken(config.token);
  
  // Check for DEV_GUILD_ID - this is required for dev cleanup
  const devGuildId = process.env.DEV_GUILD_ID;
  
  if (!devGuildId) {
    console.error('❌ DEV_GUILD_ID environment variable is required for dev command cleanup');
    console.log('💡 Set DEV_GUILD_ID in your environment variables to clean up dev commands');
    process.exit(1);
  }
  
  console.log(`DEV_GUILD_ID: ${devGuildId} (cleaning up DEV commands)`);
  
  try {
    // Get existing commands for this guild
    const existingCommands = await rest.get(Routes.applicationGuildCommands(config.clientId, devGuildId));
    console.log(`Found ${existingCommands.length} existing dev commands`);
    
    if (existingCommands.length === 0) {
      console.log(`✅ No dev commands to clean up for guild ${devGuildId}`);
      return;
    }
    
    // Delete all existing commands for this guild
    console.log(`🗑️ Deleting ${existingCommands.length} dev commands from guild ${devGuildId}...`);
    
    let totalCleaned = 0;
    for (const command of existingCommands) {
      try {
        await rest.delete(Routes.applicationGuildCommand(config.clientId, devGuildId, command.id));
        console.log(`  ✅ Deleted: ${command.name}`);
        totalCleaned++;
      } catch (error) {
        console.error(`  ❌ Failed to delete ${command.name}:`, error.message);
      }
    }
    
    console.log(`✅ Dev command cleanup completed for guild ${devGuildId}`);
    console.log(`📊 Total dev commands deleted: ${totalCleaned}`);
    
  } catch (error) {
    console.error(`❌ Failed to cleanup dev commands for guild ${devGuildId}:`, error.message);
    process.exit(1);
  }
  
  console.log(`\n🎉 Dev command cleanup completed!`);
  console.log(`\n💡 Next steps:`);
  console.log(`1. Run 'npm run register' to register clean global commands`);
  console.log(`2. Or run 'npm run build && npm run register' to rebuild and register`);
}

// Allow running directly: node scripts/clean-dev-commands.js
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1].includes('clean-dev-commands.js')) {
  console.log("🚀 Starting dev command cleanup...");
  cleanDevCommands().then(() => {
    console.log("🎉 Dev command cleanup completed successfully!");
  }).catch((err) => {
    console.error("❌ Dev command cleanup failed:", err.message);
    process.exit(1);
  });
}

export { cleanDevCommands };
