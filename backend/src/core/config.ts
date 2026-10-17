export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://nascon:nascon@localhost:5432/nascon',
  // DAY1_SALT is only ever read from the environment (never hard-coded or committed).
  salt: process.env.DAY1_SALT ?? '',
};
