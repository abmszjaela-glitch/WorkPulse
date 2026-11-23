import {createConfiguredProcessing} from '../config/processing-runtime.js';

// Trusted operator command only. Never run automatically or expose as public HTTP.
try{
  const args=process.argv.slice(2),allowed=new Set(['--employee','--date','--timezone']);
  if(!args.includes('--confirm'))throw new Error();
  const values={};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--confirm')continue;
    if(!allowed.has(args[i])||!args[i+1]||Object.hasOwn(values,args[i]))throw new Error();
    values[args[i]]=args[++i];
  }
  if(!process.env.SUPABASE_SECRET_KEY?.trim())throw new Error();
  const runtime=createConfiguredProcessing();
  await runtime.summaries.recalculate(values['--employee'],values['--date'],values['--timezone']||runtime.config.timezone);
  console.log('Daily summary recalculated');
}catch{
  console.error('Recalculation failed. Verify approved migrations, configuration, closed date and --employee/--date/--timezone/--confirm arguments.');
  process.exitCode=1;
}
