import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/api-error.js';

export const opaqueToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

export function createTokenService(config) {
  return {
    sign(user, session) {
      return jwt.sign({ sid: session.id, token_use: 'access', role: session.device_id ? 'Agent' : user.role,
        version: user.auth_version, ...(session.device_id ? { device_id: session.device_id } : {}) }, config.secret, {
        algorithm: 'HS256', issuer: config.issuer, audience: session.device_id ? config.agentAudience : config.userAudience,
        subject: user.id, jwtid: randomUUID(), expiresIn: config.accessSeconds,
      });
    },
    verify(token) {
      try {
        const claims = jwt.verify(token, config.secret, { algorithms: ['HS256'], issuer: config.issuer,
          audience: [config.userAudience, config.agentAudience] });
        const device = claims.aud === config.agentAudience;
        if (claims.token_use !== 'access' || typeof claims.sub !== 'string' || typeof claims.sid !== 'string'
            || !Number.isInteger(claims.version) || !Number.isInteger(claims.exp) || !claims.jti
            || (device ? claims.role !== 'Agent' || !claims.device_id : !['A', 'M', 'E'].includes(claims.role) || claims.device_id)) throw new Error();
        return claims;
      } catch { throw new ApiError(401, 'Invalid or expired access token'); }
    },
  };
}
