import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import isEmail from 'validator/lib/isEmail.js';
import supabase from '../config/supabase.js';
import { loadAuthConfig } from '../config/auth.js';
import { hashPassword, validatePassword } from '../services/passwords.js';

// Interactive trusted-operator command, never part of the HTTP application.
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Run bootstrap-admin interactively in a terminal');
  process.exitCode = 1;
} else {
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const prompt = createInterface({ input: process.stdin, output, terminal: true });
  let password, confirmation;
  try {
    const config = loadAuthConfig();
    const email = (await prompt.question('Initial administrator email: ')).trim().toLowerCase();
    if (!isEmail(email) || email.length > 254) throw new Error();
    process.stdout.write('Password (hidden): '); muted = true;
    password = await prompt.question('');
    muted = false; process.stdout.write('\nConfirm password (hidden): '); muted = true;
    confirmation = await prompt.question('');
    muted = false; process.stdout.write('\n');
    validatePassword(password);
    if (password !== confirmation) throw new Error();
    const passwordHash = await hashPassword(password, config.bcryptRounds);
    const { error } = await supabase.rpc('wp_auth_bootstrap_admin', { p_id: randomUUID(), p_email: email, p_password_hash: passwordHash });
    if (error) throw new Error();
    console.log('Initial administrator created');
  } catch {
    console.error('Bootstrap failed: verify configuration, migration, password policy and that no account already exists');
    process.exitCode = 1;
  } finally {
    password = confirmation = undefined;
    prompt.close(); output.end();
  }
}
