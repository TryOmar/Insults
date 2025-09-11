import 'dotenv/config';

export const config = {
  token: process.env.DISCORD_TOKEN!,
  clientId: process.env.DISCORD_CLIENT_ID!,
  databaseUrl: process.env.DATABASE_URL!,
  environment: process.env.NODE_ENV ?? 'development',
};


