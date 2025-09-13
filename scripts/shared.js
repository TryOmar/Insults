import dotenv from "dotenv";
import { REST } from 'discord.js';

// Load environment variables from both files
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.deploy" });

export const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  sftp: {
    host: process.env.SFTP_HOST,
    port: Number(process.env.SFTP_PORT),
    username: process.env.SFTP_USER,
    password: process.env.SFTP_PASS,
  },
  websocket: {
    url: process.env.DEPLOY_WS_URL,
    origin: process.env.DEPLOY_ORIGIN,
    cookie: process.env.DEPLOY_COOKIE,
    referer: process.env.DEPLOY_REFERER,
  }
};

export const headers = {
  accept: "application/json",
  "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
  pragma: "no-cache",
  priority: "u=1, i",
  referer: config.websocket.referer,
  "sec-ch-ua": '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "x-requested-with": "XMLHttpRequest",
  cookie: config.websocket.cookie,
};

export function createREST() {
  if (!config.token) {
    throw new Error('DISCORD_TOKEN not found in environment variables');
  }
  return new REST({ version: '10' }).setToken(config.token);
}

export function validateConfig() {
  const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  console.log('✅ Environment variables validated');
  console.log(`Client ID: ${config.clientId}`);
}
