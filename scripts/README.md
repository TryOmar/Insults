# Deployment Scripts

This folder contains modular deployment scripts for the Discord bot.

## Available Scripts

### Individual Scripts

- **`build.js`** - Builds the TypeScript project
- **`upload.js`** - Uploads the dist folder to the server via SFTP
- **`register-commands.js`** - Registers Discord slash commands
- **`cleanup-commands.js`** - Removes all existing Discord commands
- **`restart-server.js`** - Restarts the server via WebSocket

### Shared Utilities

- **`shared.js`** - Contains shared configuration and utilities

## NPM Scripts

You can run these scripts using npm:

```bash
# Register Discord commands
npm run register

# Upload dist folder to server
npm run upload

# Restart the server
npm run restart

# Full deployment (build + upload + register + restart)
npm run deploy
```

### Additional Scripts (not in package.json)

- **`cleanup-commands.js`** - Remove all existing Discord commands (run once to fix duplicates)
- **`build.js`** - Build TypeScript project (reusable component)

## Environment Variables

All scripts require the following environment variables in `.env.deploy`:

```env
# Discord Bot
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id

# SFTP Upload
SFTP_HOST=your_sftp_host
SFTP_PORT=22
SFTP_USER=your_username
SFTP_PASS=your_password

# WebSocket Restart
DEPLOY_WS_URL=your_websocket_url
DEPLOY_ORIGIN=your_origin
DEPLOY_COOKIE=your_cookie
DEPLOY_REFERER=your_referer
```

## Usage Examples

### Clean up duplicate commands and redeploy:
```bash
node scripts/cleanup-commands.js
npm run deploy
```

### Just register new commands:
```bash
npm run register
```

### Just restart the server:
```bash
npm run restart
```

### Build and upload without restarting:
```bash
npm run build
npm run upload
```
