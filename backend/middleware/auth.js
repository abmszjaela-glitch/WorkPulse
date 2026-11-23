import { ApiError } from '../utils/api-error.js';

export const authenticate = (service) => async (req, res, next) => {
  const authorization = req.get('authorization');
  if (!authorization || !/^Bearer [^\s]+$/i.test(authorization)) throw new ApiError(401, 'Bearer access token required');
  req.auth = await service.authenticate(authorization.slice(7));
  next();
};

export const authorize = (...roles) => (req, res, next) => {
  if (!req.auth) throw new ApiError(401, 'Authentication required');
  if (!roles.includes(req.auth.role) || (req.auth.role === 'Agent' && req.auth.kind !== 'device')) throw new ApiError(403, 'Forbidden');
  if (req.auth.mustChangePassword) throw new ApiError(403, 'Password change required');
  next();
};

export const authorizeEmployee = (service, parameter = 'id') => async (req, res, next) => {
  if (!req.auth) throw new ApiError(401, 'Authentication required');
  if (req.auth.mustChangePassword || !await service.canReadEmployee(req.auth, req.params[parameter])) throw new ApiError(403, 'Forbidden');
  next();
};
