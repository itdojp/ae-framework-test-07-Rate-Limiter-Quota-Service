import { createApp } from './server/app.js';
import { createEngineFromEnv } from './domain/engine-factory.js';

const app = createApp(createEngineFromEnv());
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

app
  .listen({ port, host })
  .then(() => {
    process.stdout.write(`rate-limiter service listening on ${host}:${port}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
  });
