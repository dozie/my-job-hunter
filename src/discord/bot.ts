import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Collection,
  type ChatInputCommandInteraction,
  type SlashCommandBuilder,
} from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';
import { topjobsCommand } from './commands/topjobs.js';
import { alljobsCommand } from './commands/alljobs.js';
import { tailorCommand } from './commands/tailor.js';
import { generateCoverCommand } from './commands/generate-cover.js';
import { generateResponseCommand } from './commands/generate-response.js';
import { jobCommand } from './commands/job.js';
import { rescoreCommand } from './commands/rescore.js';

const log = logger.child({ module: 'discord:bot' });

export interface BotCommand {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const commands: BotCommand[] = [
  topjobsCommand,
  alljobsCommand,
  tailorCommand,
  generateCoverCommand,
  generateResponseCommand,
  jobCommand,
  rescoreCommand,
];
const commandMap = new Collection<string, BotCommand>();

for (const cmd of commands) {
  commandMap.set(cmd.data.name, cmd);
}

export async function createBot(): Promise<Client> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once('ready', (c) => {
    log.info({ user: c.user.tag }, 'Discord bot ready');
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = commandMap.get(interaction.commandName);
    if (!command) {
      log.warn({ command: interaction.commandName }, 'Unknown command');
      return;
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      log.error({ err, command: interaction.commandName }, 'Command execution failed');
      const reply = { content: 'An error occurred while executing this command.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
  });

  return client;
}

export async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
  const body = commands.map(c => c.data.toJSON());

  log.info({ count: body.length }, 'Registering slash commands');
  await rest.put(
    Routes.applicationGuildCommands(
      (await rest.get(Routes.currentApplication()) as { id: string }).id,
      env.DISCORD_GUILD_ID,
    ),
    { body },
  );
  log.info('Slash commands registered');
}

export async function startBot(): Promise<Client> {
  const client = await createBot();
  await registerCommands();
  await client.login(env.DISCORD_TOKEN);
  return client;
}
