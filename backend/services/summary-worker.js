// DB rows/transactions provide durability and cross-process exclusion; the timer only wakes work.
export function createSummaryWorker({service,config,logger=console,setTimer=setTimeout,clearTimer=clearTimeout}){
  let running=false,timer=null,inFlight=null;
  const runOnce=()=>{
    if(inFlight)return inFlight;
    inFlight=Promise.resolve().then(()=>service.runScheduled()).then(result=>{
        if(result.failed)logger.error('Daily summary jobs failed; retained for retry');
        if(result.completed)logger.info('Daily summary jobs completed');
        return result;
      }).catch(()=>{logger.error('Daily summary processing failed; pending work retained');return {failed:1};})
      .finally(()=>{inFlight=null;});
    return inFlight;
  };
  async function tick(){await runOnce();if(running){timer=setTimer(tick,config.pollSeconds*1000);timer.unref?.();}}
  return {
    start(){if(running||!config.enabled)return;running=true;logger.info('Daily summary worker started');void tick();},
    runOnce,
    async stop(){running=false;if(timer)clearTimer(timer);timer=null;if(inFlight)await inFlight;},
  };
}
