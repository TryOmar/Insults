## Insults Bot

A Discord bot that records, ranks, and analyzes insults in a server. Built with TypeScript, `discord.js` v14, and Prisma.

### Features
- Persistent storage of insults with metadata (guild, insulted user, blamer, timestamps, optional note)
- Slash commands for adding entries, leaderboards, and per-user stats
- Live leaderboard message refresh support
- Clean text table rendering for lists

### Commands
- **/blame**: Record an insult for a user
  - Options: `user` (required), `insult` (required), `note` (optional)
- **/unblame**: Remove a recent insult you added (project-specific behavior)
- **/rank**: Show leaderboard of top insulted users in the guild
- **/stats**: Show recent insults for a specific user in the guild
- **/detail**: Show details for a particular insult or user (project-specific behavior)
- **/live_rank**: Manage a live-updating leaderboard message in a channel
- **/form**: Two-step flow to record an insult via UI components
  - Step 1: Ephemeral message with a User Select (choose the insulted user)
  - Step 2: Modal opens to capture `Insult` (required) and `Optional Note`

Important note about modals: Discord modals only support text inputs. Select menus (User/Role/Mentionable/String) cannot exist inside a modal. Therefore, the user selection occurs in the ephemeral message, and the modal collects text inputs only.

### Tech Stack
- Node.js (TypeScript)
- `discord.js` ^14.22.1
- Prisma ORM with SQLite (dev by default)

### Project Structure
```
src/
  commands/
  events/
  database/
  utils/
  index.ts
prisma/
  schema.prisma
```

Key files:
- `src/index.ts`: Client setup and event wiring
- `src/events/interactionCreate.ts`: Central interaction router
- `src/commands/*.ts`: Command handlers
- `src/config.ts`: Loads environment variables
- `src/database/client.ts`: Prisma client
- `src/utils/*`: Helpers (e.g., command registration, table renderer)

### Database
Prisma schema (SQLite by default): see `prisma/schema.prisma`.

Models:
- `User`: `id`, `username`
- `Insult`: `id`, `guildId`, `userId`, `blamerId`, `insult`, `note?`, `createdAt`

Indexes:
- `Insult(guildId, userId)` and `Insult(guildId, blamerId)`

### Configuration
Environment variables (in `.env`):
- `DISCORD_TOKEN` (required): Bot token
- `DISCORD_CLIENT_ID` (required): Application client ID
- `DATABASE_URL` (required): Prisma database URL (e.g., `file:./dev.db` for SQLite)
- `NODE_ENV` (optional): `development` or `production` (defaults to `development`)

Example `.env` for SQLite:
```
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-client-id
DATABASE_URL=file:./prisma/dev.db
NODE_ENV=development
```

### Scripts
Defined in `package.json`:
- `npm run build`: TypeScript build to `dist/`
- `npm run dev`: Watch mode with `nodemon` + `tsx`, runs `src/index.ts`
- `npm start`: Run compiled `dist/index.js`

### Setup & Development
1) Install dependencies
```
npm install
```

2) Prepare the database
```
npx prisma generate
npx prisma db push
```

3) Run locally
```
npm run dev
```

4) Register slash commands
```
npx tsx src/utils/registerCommands.ts
```

The registration script uses `DISCORD_CLIENT_ID` and (optionally) `DEV_GUILD_ID` to register commands. If `DEV_GUILD_ID` is set, commands register for that guild; otherwise, they register globally (and may take up to an hour to appear).

### Permissions & Intents
The bot uses the `Guilds` intent and message reads for some utilities. Ensure the application has the appropriate intents enabled in the Discord Developer Portal and that the bot is invited with the needed scopes (`bot`, `applications.commands`).

### Implementation Notes
- The `/form` flow intentionally uses a User Select in an ephemeral message to choose the target user, then opens a modal for text inputs. This aligns with Discord API limitations (no select menus inside modals).
- After actions that modify data (e.g., `/blame`, `/unblame`), the live leaderboard (if configured) is refreshed.

### Troubleshooting
- Commands not showing: re-run the registration script; for global commands, wait up to an hour. For rapid iteration, set `DEV_GUILD_ID` and register per-guild.
- Auth errors: verify `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` in `.env`.
- Prisma errors: ensure `DATABASE_URL` points to a valid location; run `npx prisma generate` and `npx prisma db push`.
- Modal/select issues: remember selects cannot be embedded within modals; trigger the modal from a select interaction instead.

### License
ISC (see `package.json`).


