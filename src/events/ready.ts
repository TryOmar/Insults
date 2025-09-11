import { Client } from 'discord.js';

export function onReady(client: Client) {
  console.log(`Logged in as ${client.user?.tag}`);
}
