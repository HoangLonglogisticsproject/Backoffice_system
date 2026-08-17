import { Observable } from 'rxjs';
import { UserContext } from '@bo/types';

/**
 * The authentication boundary. Backoffice does not sign anyone in — the
 * gateway/SSO does, and this contract is how the client asks who that is.
 */
export abstract class SessionRepository {
  abstract current(): Observable<UserContext>;

  /**
   * Personas available to switch between. Non-empty only in demo/fixture mode;
   * a production implementation returns [] and the switcher disappears.
   */
  abstract personas(): Observable<UserContext[]>;

  abstract switchPersona(userId: string): Observable<UserContext>;
}
