import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import type { ServerOptions } from 'socket.io';

/**
 * The socket.io server, configured from the validated environment.
 *
 * ★ WHY AN ADAPTER AND NOT OPTIONS ON `@WebSocketGateway`. That decorator is
 * evaluated when the class is DEFINED — before the container exists, so before
 * `AppConfig` does. Putting the allowlist there would mean reading
 * `process.env` at module load, which is the one thing B6 forbids and for a
 * good reason: the schema in `config/` is where an environment is proved valid,
 * and a second reader that skips it is a second definition of "configured".
 * `main.ts` has the resolved config, so the server is built there, with it.
 *
 * ★ THE SAME ALLOWLIST AS HTTP, AND CREDENTIALS ON. The handshake carries the
 * session cookie — that is the whole of how a connection is authenticated — so
 * it must be a credentialed cross-origin request in development, where the SPA
 * is on :4200 and the API is not. In production both sit behind one origin and
 * the list is empty, which turns CORS off exactly as it does for HTTP.
 *
 * ⚠ CORS IS NOT THE AUTHENTICATION. It decides which PAGE may open the socket;
 * `NotificationGateway` decides whose session it is, and refuses identically
 * whatever the origin. A deployment that widened this list would still have
 * every connection resolved against a real session.
 */
export class SessionIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly corsOrigins: readonly string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      // Empty list = same-origin only, matching `main.ts`: passing `origin: []`
      // to socket.io would refuse every browser instead, so CORS is left off.
      ...(this.corsOrigins.length > 0
        ? { cors: { origin: [...this.corsOrigins], credentials: true } }
        : {}),
    });
  }
}
