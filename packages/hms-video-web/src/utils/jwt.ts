import { ErrorFactory, HMSAction } from '../error/ErrorFactory';

export interface AuthToken {
  roomId: string;
  userId: string;
  role: string;
}

export default function decodeJWT(token: string): AuthToken {
  if (token.length === 0) {
    throw ErrorFactory.InitAPIErrors.InvalidTokenFormat(HMSAction.INIT, 'Token cannot be an empty string');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw ErrorFactory.InitAPIErrors.InvalidTokenFormat(
      HMSAction.INIT,
      `Expected 3 '.' separate fields - header, payload and signature respectively`,
    );
  }

  const payloadStr = atob(parts[1]);
  try {
    const payload = JSON.parse(payloadStr);
    return {
      roomId: payload.room_id,
      userId: payload.user_id,
      role: payload.role,
    } as AuthToken;
  } catch (err) {
    throw ErrorFactory.InitAPIErrors.InvalidTokenFormat(HMSAction.INIT, (err as Error).message);
  }
}
