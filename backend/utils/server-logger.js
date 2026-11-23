// Structured, allowlisted diagnostics. Never serialize Error objects, headers,
// payloads, SMTP failures or database messages (they may contain credentials).
export function logFailure(event,error,writer=console.error){
  const record={level:'ERROR',event,time:new Date().toISOString()};
  if(process.env.NODE_ENV!=='production'){
    record.errorType=['Error','TypeError','RangeError','SyntaxError','ApiError'].includes(error?.name)?error.name:'Error';
    if(['EADDRINUSE','ECONNREFUSED','ETIMEDOUT','ECONNRESET'].includes(error?.code))record.code=error.code;
  }
  try{writer(JSON.stringify(record));}catch{/* Logging failure must not mask the original error. */}
}
