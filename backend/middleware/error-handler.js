import {logFailure} from '../utils/server-logger.js';

export function notFound(req, res) {
  res.status(404).json({ error: { message: 'Route not found' } });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  // Raw exceptions can contain submitted data or secrets.
  if (status >= 500) logFailure('api.request.failed',err);
  const message = err.safeMessage || (err.type === 'entity.parse.failed' ? 'Invalid JSON body'
    : status === 413 ? 'Request body too large' : status < 500 ? 'Invalid request' : 'Internal server error');
  const diagnostics=process.env.NODE_ENV==='development'?{diagnostics:{status,type:['TypeError','RangeError','SyntaxError'].includes(err.name)?err.name:'Error'}}:{};
  res.status(status).json({ ...(req.analytics ? {success:false,message,data:null} : {}),error: { message },...diagnostics });
}

