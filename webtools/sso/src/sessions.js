// The session: how it is built, when it has expired, what is shown of it.
//
// The document stored in anagraphics is this one, and there is no other inside the
// sso: whoever answers `GET /session` reads exactly what is in the database, so a
// second sso process sees the same sessions as the first.
//
//   {
//     token:      a random string, the only secret going around
//     uid:        the person's identity
//     username:   what they typed at the login
//     issued_at:  when they came in
//     expires_at: when it stops counting
//     data:       session data, free. Today it holds the photograph of the user at
//                 login time (screen_name, driver_uid), so reading a session does
//                 not cost a second read, and the language (locale), which changes
//                 with the pages' switcher.
//   }
//
// The photograph ages: if the `screen_name` changes, sessions already open go on
// showing the old one until the next login. It is the same trade-off already made
// for the driver inside the discount codes.

import { randomBytes } from "node:crypto";

// 32 random bytes: the token holds no information, cannot be guessed and says
// nothing about itself. Whoever has it has the session; whoever wants to read it
// asks here.
const TOKEN_BYTES = 32;

export function newToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

// `locale`: the session's language, already decided by whoever performs the login.
export function buildSession(user, ttlSeconds, now = new Date(), locale = null) {
  const issuedAt = new Date(now.getTime());
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  return {
    token: newToken(),
    uid: user.uid,
    username: user.username,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    data: {
      screen_name: user.screen_name ?? null,
      driver_uid: user.driver_uid ?? null,
      locale,
    },
  };
}

// A session with no readable expiry has expired: if we do not know how long it is
// good for, it is not good.
export function isExpired(session, now = new Date()) {
  const expiresAt = Date.parse(session?.expires_at ?? "");
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt <= now.getTime();
}
