import pino from 'pino';

function buildTransport(): pino.TransportSingleOptions | pino.TransportMultiOptions | undefined {
  const targets: pino.TransportTargetOptions[] = [];

  if (process.env.NODE_ENV === 'development') {
    targets.push({ target: 'pino-pretty', options: { colorize: true }, level: 'trace' });
  }

  if (process.env.AXIOM_TOKEN && process.env.AXIOM_DATASET) {
    targets.push({
      target: '@axiomhq/pino',
      options: {
        dataset: process.env.AXIOM_DATASET,
        token: process.env.AXIOM_TOKEN,
      },
      level: 'info',
    });
  }

  if (targets.length === 0) return undefined;
  return { targets };
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: buildTransport(),
});
