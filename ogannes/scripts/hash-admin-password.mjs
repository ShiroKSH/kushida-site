import { hash } from '@node-rs/argon2';

const password = process.argv.slice(2).join(' ');
if (!password) {
  console.error('Usage: npm run hash-admin-password -- "your password"');
  process.exit(1);
}

console.log(await hash(password));
