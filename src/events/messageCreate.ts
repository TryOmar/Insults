import { EmbedBuilder, Message } from 'discord.js';

export async function handleMessage(message: Message) {
  // Ignore bot and system messages
  if (message.author.bot || message.system) return;
  if (!message.client.user) return;

  // If the bot is mentioned in the message, reply with info
  if (message.mentions.has(message.client.user, { ignoreEveryone: true, ignoreRoles: true })) {
    const embed = new EmbedBuilder()
      .setTitle('Insults Bot')
      .setDescription('Track and analyze playful insults in your server.')
      .addFields(
        { name: 'Commands', value: '`/blame @user insult [note]`, `/rank`' },
        { name: 'How it works', value: 'Records who blamed whom, when, with optional notes. Shows leaderboards and per-user histories.' },
      )
      .setFooter({ text: 'Tip: Use /rank to see the leaderboard.' })
      .setTimestamp();

    try {
      await message.reply({ embeds: [embed] });
    } catch {
      // Silently ignore errors (e.g., lack of permission)
    }
  }

}
