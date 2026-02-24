import { EmbedBuilder } from 'discord.js';
import type { Job } from '../db/schema.js';

export function buildJobEmbed(job: Job, index?: number): EmbedBuilder {
  const title = index !== undefined
    ? `#${index + 1} — ${job.title}`
    : job.title;

  const embed = new EmbedBuilder()
    .setTitle(title.slice(0, 256))
    .setURL(job.link)
    .setColor(getScoreColor(Number(job.score)))
    .addFields(
      { name: 'Company', value: job.company, inline: true },
      { name: 'Score', value: `${job.score}/10`, inline: true },
      {
        name: 'Remote',
        value: job.remoteEligible ? 'Yes' : 'No',
        inline: true,
      },
    );

  if (job.seniority) {
    embed.addFields({ name: 'Seniority', value: capitalize(job.seniority), inline: true });
  }

  if (job.interviewStyle && job.interviewStyle !== 'unknown') {
    embed.addFields({ name: 'Interview', value: capitalize(job.interviewStyle), inline: true });
  }

  if (job.compensation) {
    embed.addFields({ name: 'Compensation', value: job.compensation, inline: true });
  }

  if (job.location) {
    embed.addFields({ name: 'Location', value: job.location, inline: false });
  }

  if (job.summary) {
    embed.setDescription(job.summary);
  }

  embed.setFooter({ text: `ID: ${job.id} | ${job.provider}` });
  embed.setTimestamp(job.createdAt);

  return embed;
}

function getScoreColor(score: number): number {
  if (score >= 7) return 0x2ecc71; // green
  if (score >= 4) return 0xf39c12; // orange
  return 0xe74c3c; // red
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
