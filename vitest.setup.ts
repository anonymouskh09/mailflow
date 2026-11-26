// Tests run against a dedicated database so they never touch dev data.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://mailflow:mailflow@localhost:5432/mailflow_test';
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
process.env.SESSION_SECRET ??= 'test-session-secret-test-session-secret';
process.env.APP_URL ??= 'http://localhost:3000';
process.env.TRACKING_URL ??= 'http://localhost:3000';
process.env.DELAY_UNIT = 'days';
process.env.DEV_IGNORE_SCHEDULE = 'false';
process.env.DEV_SMTP_OVERRIDE = '';
process.env.VITEST = '1';
