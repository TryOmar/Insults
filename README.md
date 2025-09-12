# Insults Bot

A Discord bot that tracks, analyzes, and manages insult patterns in your server to promote healthier conversations through self-awareness.

## Overview

The Insults Bot helps server members become more aware of their communication patterns by tracking insults, providing leaderboards, and offering detailed analytics. The goal is to reduce negative communication through visibility and accountability.

## Features

- **Comprehensive Tracking**: Record insults with metadata (user, blamer, timestamp, notes)
- **Analytics & Reporting**: View leaderboards, statistics, and detailed history
- **Archive System**: Archive and restore blame records for better management
- **Auto-Detection**: Optional radar system for automatic insult detection
- **Interactive UI**: Modern slash commands with modals and select menus

## Commands

### Recording Commands
- `/blame @user insult [note]` - Record an insult against a user
- `/unblame <id>` - Delete a blame record by ID

### Viewing Commands
- `/rank` - Show the insult leaderboard
- `/insults [word]` - Show insult statistics
- `/history [@user]` - Show insult history
- `/detail <id>` - Show details for a specific blame record

### Management Commands
- `/radar <enabled>` - Toggle automatic insult detection
- `/archive [@user] [role]` - Show archived blame records
- `/revert <id>` - Restore archived blames back into active records
- `/help` - Show this help information

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Discord API**: discord.js v14.22.1
- **Database**: SQLite with Prisma ORM
- **Build Tools**: TypeScript, tsx, nodemon

## Quick Start

### Prerequisites
- Node.js (LTS recommended)
- Discord Application with Bot Token

### Installation

1. **Clone and install dependencies**
   ```bash
   git clone <repository-url>
   cd insults
   npm install
   ```

2. **Configure environment**
   Create a `.env` file:
   ```env
   DISCORD_TOKEN=your-bot-token
   DISCORD_CLIENT_ID=your-client-id
   DATABASE_URL=file:./prisma/dev.db
   NODE_ENV=development
   ```

3. **Setup database**
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. **Register commands**
   ```bash
   npx tsx src/utils/registerCommands.ts
   ```

5. **Start the bot**
   ```bash
   npm run dev
   ```

## Development

### Available Scripts
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Run production build

### Database Management
- `npx prisma db push` - Sync schema with database
- `npx prisma db push --force-reset` - Reset database (clears all data)
- `npx prisma studio` - Open database GUI

### Project Structure
```
src/
├── commands/          # Slash command handlers
├── events/           # Discord event handlers
├── database/         # Prisma client and types
├── services/         # Business logic
├── utils/            # Helper functions
└── index.ts          # Application entry point

prisma/
└── schema.prisma     # Database schema
```

## Configuration

### Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Yes | Application client ID |
| `DATABASE_URL` | Yes | Database connection string |
| `DEV_GUILD_ID` | No | Guild ID for development (registers commands locally) |
| `NODE_ENV` | No | Environment mode (development/production) |

### Discord Permissions
Required bot permissions:
- `bot` - Basic bot functionality
- `applications.commands` - Slash command support

Required intents:
- `Guilds` - Server information and slash commands

## Database Schema

### Models
- **User**: Discord user information (`id`, `username`)
- **Insult**: Blame records (`id`, `guildId`, `userId`, `blamerId`, `insult`, `note`, `createdAt`)
- **Archive**: Archived blame records with unblame tracking
- **Setup**: Guild configuration (`guildId`, `radarEnabled`)

### Indexes
- `Insult(guildId, userId)` - Fast user-specific queries
- `Insult(guildId, blamerId)` - Fast blamer-specific queries

## Troubleshooting

### Common Issues
- **Commands not appearing**: Re-run registration script; global commands take up to 1 hour
- **Database errors**: Ensure `DATABASE_URL` is correct and run `npx prisma generate`
- **Permission errors**: Verify bot has required permissions and intents
- **Modal issues**: Remember that select menus cannot be embedded in modals

### Development Tips
- Use `DEV_GUILD_ID` for faster command updates during development
- Check logs for detailed error information
- Use `npx prisma studio` to inspect database contents

## License

ISC License - see `package.json` for details.

---

**Note**: This bot is designed to promote positive communication patterns through awareness and accountability. Use responsibly and in accordance with your server's community guidelines.