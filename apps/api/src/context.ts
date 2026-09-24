import type { Config } from './config';
import type { Database } from './db/client';
import type { Notifier } from './notifier';
import type { WindowCounter } from './security';

export interface Ctx {
  db: Database;
  config: Config;
  notifier: Notifier;
  /** Frena la fuerza bruta por cuenta (login, OTP) aunque cambie la IP. */
  accountLimiter: WindowCounter;
}
