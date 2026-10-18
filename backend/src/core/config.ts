export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://nascon:nascon@localhost:5432/nascon',
  // DAY1_SALT is only ever read from the environment (never hard-coded or committed).
  salt: process.env.DAY1_SALT ?? '',
  // Phase II signatures use their own salt (also environment-only, never trimmed or length-checked).
  day2Salt: process.env.DAY2_SALT ?? '',
  // Optional dependencies: /health only probes the ones that are configured.
  redisUrl: process.env.REDIS_URL ?? '',
  mediaApiUrl: process.env.MEDIA_API_URL ?? '',
};
