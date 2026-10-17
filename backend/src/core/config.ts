export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://nascon:nascon@localhost:5432/nascon',
  // DAY1_SALT is only ever read from the environment (never hard-coded or committed).
  salt: process.env.DAY1_SALT ?? '',
  // Payments default to the in-repo mock gateway (required by the competition spec).
  // Real Stripe is opt-in via PAYMENT_PROVIDER=stripe; keys are read from the environment only.
  paymentProvider: process.env.PAYMENT_PROVIDER === 'stripe' ? 'stripe' : 'mock',
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  },
};
