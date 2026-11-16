// Resets a user's password from the server's command line, for when someone forgets theirs:
//   docker compose exec app node server/dist/reset-password.js <username> <new-password>
import bcrypt from "bcryptjs";
import { db } from "./db.js";

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 8) {
  console.error("Usage: node server/dist/reset-password.js <username> <new-password>   (password: at least 8 characters)");
  process.exit(1);
}
const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number } | undefined;
if (!user) {
  const names = (db.prepare("SELECT username FROM users ORDER BY username").all() as { username: string }[]).map((u) => u.username);
  console.error(`No user called "${username}". Users: ${names.join(", ") || "(none)"}`);
  process.exit(1);
}
db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(password, 12), user.id);
// Sign the user out everywhere so the old password's sessions stop working.
db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
console.log(`Password updated for ${username}. They can sign in with the new password now.`);
