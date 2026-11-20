export function notFound(req, res) {
  res.status(404).json({ error: { message: 'Route not found' } });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  // Raw exceptions can contain submitted data or secrets.
  if (status >= 500) console.error('Unhandled API error');
  const message = err.type === 'entity.parse.failed' ? 'Invalid JSON body'
    : status === 413 ? 'Request body too large' : status < 500 ? 'Invalid request' : 'Internal server error';
  res.status(status).json({ error: { message } });
}
