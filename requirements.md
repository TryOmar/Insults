# 🗡️ Insults Bot – Product Requirements

## 1. Overview
The Insults Bot is a Discord bot that records, ranks, and analyzes insulting language within a server. It enables communities to track patterns, view leaderboards, and inspect per-user histories for moderation or social insight.

## 2. Goals & Non-Goals
- Goals
  - Persistently record reported insults with metadata (who blamed whom, when, and optional note).
  - Provide slash commands for adding entries, viewing leaderboards, and per-user stats.
  - Offer simple, reliable, and fast responses via embeds.
- Non-Goals (MVP)
  - Automatic message scanning or content moderation.
  - Cross-guild analytics and dashboards.
  - Web UI or export features.

## 3. User Roles
- Regular Member: Can submit `/blame`, view `/rank`, and view `/stats`.
- Moderator/Admin: Same as member; moderation-specific permissions out of scope for MVP.

## 4. Slash Commands

### 4.1 `/blame`
- Purpose: Add an insult record for a mentioned user.
- Parameters
  - `user` (required, user mention): Insulted user.
  - `insult` (required, string ≤ 140 chars): Word or short phrase (up to 3 words, max 20 chars per word).
  - `note` (optional, string ≤ 500 chars): Context or comment.
- Behavior
  - Records `user_id`, `blamer_id` (invoker), `insult`, `note`, `created_at`.
  - Ensures `user` and `blamer` are not bots; if they are, return an error.
  - Trims and validates input lengths; rejects empty strings.
- Success Response (embed)
  - Title: "Blame recorded"
  - Fields: `Insulted User`, `Insult`, `Note (optional)`, `Blamed By`, `When`
- Errors
  - Missing required parameters
  - Invalid lengths
  - Bot users not allowed
- Examples
```
  /blame @ameer "shit" note:"friendly banter"
```

### 4.2 `/rank`
- Purpose: Show leaderboard of users ranked by total insults.
- Behavior
  - Aggregates insult counts per user in the current guild.
  - Sorts descending by count; ties broken by earliest first insult.
  - Paginates if more than 10 results.
- Success Response (embed)
  - Title: "Insult Leaderboard"
  - Fields: rank number, user mention, total count
- Example
```
  /rank
```

### 4.3 `/stats`
- Purpose: Show detailed recent insults for a specific user.
- Parameters
  - `user` (required, user mention)
- Behavior
  - Lists the last 10 insults for the user in the current guild.
  - Shows `insult`, `note`, and `created_at`.
- Success Response (embed)
  - Title: "Insults for <user>"
  - Table-like fields: `Insult | Note | Date`
- Example
```
/stats @ameer
```

## 5. Data Model

### 5.1 Entities
- Users
  - `id` (PK; Discord user ID, string)
  - `username` (string)

- Insults
  - `id` (PK; auto-increment integer)
  - `guild_id` (string; Discord guild ID)
  - `user_id` (FK → Users.id) – insulted user
  - `blamer_id` (FK → Users.id) – reporting user
  - `insult` (text, required)
  - `note` (text, optional)
  - `created_at` (timestamp, default now)

### 5.2 Suggested DDL (SQLite/PostgreSQL)
```sql
-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL
);

-- Insults
CREATE TABLE IF NOT EXISTS insults (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  blamer_id TEXT NOT NULL REFERENCES users(id),
  insult TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_insults_guild_user ON insults (guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_insults_guild_blamer ON insults (guild_id, blamer_id);
```

## 6. Validation & Constraints
- `insult`: 1–140 chars; trimmed; no newlines; up to 3 words; max 20 chars per word.
- `note`: 0–500 chars; trimmed; newlines collapsed or rejected.
- `user` and `blamer` must differ; invoker can blame self (allowed) – configurable later.
- Ignore or reject bot users for both `user` and `blamer` (MVP: reject with error).
- All queries scoped by `guild_id` to avoid cross-server leakage.

## 7. Features (MVP)
1. Persistent insult storage with `user_id` and `blamer_id`.
2. Slash commands with basic autocomplete for users.
3. Leaderboard by insult count with pagination.
4. Per-user stats view with recent entries.
5. Robust error handling and input validation.

## 8. Non-Functional Requirements
- Performance: Command response ≤ 1s P50, ≤ 3s P95 under light load.
- Reliability: Commands must gracefully handle Discord API errors and DB timeouts.
- Privacy: Store only minimal data necessary; do not store message content beyond `insult` and `note` input.
- Security: Use least-privileged bot scopes; keep tokens in environment variables.
- Observability: Log command usage and errors with correlation IDs; no PII in logs.

## 9. Tech Stack
- Language: TypeScript (Node.js LTS)
- Discord Library: `discord.js`
- Database: SQLite (local/dev) or PostgreSQL (prod)
- ORM: Prisma (preferred) or Sequelize
- Hosting: Railway/Render/Heroku/VPS

## 10. Configuration
- Environment Variables
  - `DISCORD_TOKEN` (required): Bot token
  - `DISCORD_CLIENT_ID` (required): Application client ID
  - `DATABASE_URL` (required for Postgres/Prisma)
  - `NODE_ENV` (development|production)
- Permissions/Intents
  - `Guilds` intent required for slash commands
  - No privileged intents needed for MVP

## 11. File Structure (Guidance)
- `src/`
  - `commands/` → `blame.ts`, `rank.ts`, `stats.ts`
  - `events/` → `ready.ts`, `interactionCreate.ts`
  - `database/` → connection, client, repositories
  - `utils/` → formatting, pagination, error helpers
  - `config.ts` → loads environment variables and constants
- `.env` → secrets (not committed)

## 12. Development & Setup
1. Create Discord application and bot; add bot to server.
2. Set `.env` with required variables.
3. Install dependencies and run migrations.
4. Register slash commands globally or per-guild.

## 13. Command Responses (Examples)
- `/blame`
  - Success: Embed confirming record with fields mentioned above
  - Error: Human-readable reason (e.g., "Insult must be 1–140 characters")
- `/rank`
  - Success: Embed list (top 10) with pagination controls
- `/stats`
  - Success: Embed showing recent 10 entries with `Insult | Note | Date`

## 14. Acceptance Criteria (MVP)
- Can run the bot locally, register commands, and execute each command successfully.
- `/blame` creates a record with correct metadata and validation.
- `/rank` shows accurate aggregated counts scoped to the guild.
- `/stats` lists recent insults for a user with correct ordering and fields.
- Data persists across restarts.

## 15. Out of Scope (for now)
- Auto-detection from message content
- Multi-language support
- Web UI and external analytics

---

This document defines the MVP specification for a production-quality first release while keeping implementation simple and maintainable.
