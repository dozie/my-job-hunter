import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  ComponentType,
} from 'discord.js';

const PAGE_SIZE = 5;
const COLLECTOR_TIMEOUT = 120_000; // 2 minutes

export async function sendPaginatedEmbeds(
  interaction: ChatInputCommandInteraction,
  embeds: EmbedBuilder[],
  title: string,
): Promise<void> {
  if (embeds.length === 0) {
    await interaction.editReply({ content: 'No jobs found.' });
    return;
  }

  const pages = chunkArray(embeds, PAGE_SIZE);
  let currentPage = 0;

  const buildMessage = () => ({
    content: `**${title}** — Page ${currentPage + 1}/${pages.length} (${embeds.length} total)`,
    embeds: pages[currentPage],
    components: pages.length > 1 ? [buildButtons(currentPage, pages.length)] : [],
  });

  const reply = await interaction.editReply(buildMessage());

  if (pages.length <= 1) return;

  const collector = reply.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: COLLECTOR_TIMEOUT,
  });

  collector.on('collect', async (i) => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({ content: 'These buttons are not for you.', ephemeral: true });
      return;
    }

    if (i.customId === 'prev' && currentPage > 0) {
      currentPage--;
    } else if (i.customId === 'next' && currentPage < pages.length - 1) {
      currentPage++;
    }

    await i.update(buildMessage());
  });

  collector.on('end', async () => {
    try {
      await interaction.editReply({ components: [] });
    } catch {
      // interaction may have been deleted
    }
  });
}

function buildButtons(current: number, total: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('prev')
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(current === 0),
    new ButtonBuilder()
      .setCustomId('next')
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(current === total - 1),
  );
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
