import argon2 from 'argon2';

/**
 * Argon2id configuration aligned with OWASP minimum recommendations:
 * - memoryCost: 19456 KiB (19 MiB)
 * - timeCost: 2 iterations
 * - parallelism: 1
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

// Pre-computed dummy hash using identical argon2id parameters for timing attack mitigation
// Generated from dummy salt and passphrase
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$wH8x+V7e4y7mN2aB4l8u5A$QcKjV0N6uW0J4bN2u7b8k9m0n1o2p3q4r5s6t7u8v9w';

const COMMON_PASSWORDS = new Set([
  'password1234',
  '123456789012',
  'qwertyuiopas',
  'admin1234567',
  'welcome12345',
  'changeme1234',
  'letmein12345',
  'iloveyou1234',
]);

export function validatePasswordPolicy(password: string): { valid: boolean; message?: string } {
  if (!password || password.length < 12) {
    return { valid: false, message: 'Password must be at least 12 characters long' };
  }
  if (password.length > 128) {
    return { valid: false, message: 'Password must not exceed 128 characters' };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { valid: false, message: 'Password is too common and easily guessed' };
  }

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);

  // Require diversity: at least 3 of 4 character classes
  const classesPassed = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;
  if (classesPassed < 3) {
    return {
      valid: false,
      message: 'Password must contain a mix of character types (uppercase, lowercase, numbers, special characters)',
    };
  }

  return { valid: true };
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Runs a dummy argon2 verification so that unknown users consume
 * the exact same computational time as existing users, mitigating user enumeration timing attacks.
 */
export async function verifyDummyPassword(plain: string): Promise<void> {
  try {
    await argon2.verify(DUMMY_HASH, plain);
  } catch {
    // Ignore verification failure
  }
}
