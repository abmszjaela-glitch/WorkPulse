import {Server} from 'socket.io';

// Rooms are server-owned. Delivery is individually re-authorized to reflect
// revocation and Manager reassignment without waiting for a reconnect.
export function attachRealtime(httpServer,{auth,repository,config,log=console}){
  const io=new Server(httpServer,{serveClient:false,maxHttpBufferSize:16384,
    cors:{origin:config.origins,credentials:false},
    allowRequest:(req,done)=>done(null,!req.headers.origin||config.origins.includes(req.headers.origin)),
  });
  const sessions=new Map(),cleanup=new Set();let timer,validationTimer,stopped=false,busy=false,validating=false,cursor=null;
  let pollDone=Promise.resolve(),validationDone=Promise.resolve(),finishPoll,finishValidation;
  io.use(async(socket,next)=>{
    let issued;
    try{
      if(!auth)throw new Error('Unavailable');
      const credentials=socket.handshake.auth||{};
      let token=credentials.token;
      if(Object.keys(credentials).some(key=>!['token','deviceId','deviceCredential'].includes(key)))throw new Error('Invalid fields');
      if(!token&&typeof credentials.deviceId==='string'&&typeof credentials.deviceCredential==='string'){
        issued=await auth.loginDevice(credentials.deviceId,credentials.deviceCredential);token=issued.accessToken;
      }else if(credentials.deviceId||credentials.deviceCredential)throw new Error('Ambiguous credentials');
      if(typeof token!=='string'||token.length>8192)throw new Error('Invalid token');
      const context=await auth.authenticate(token);
      if(context.mustChangePassword||!['A','M','E','Agent'].includes(context.role))throw new Error('Forbidden');
      if(context.role==='Agent')await repository.run(context,'agent-authorize');
      sessions.set(socket.id,{token,context,owned:!!issued});
      // Drop raw credentials from the handshake object immediately after authentication.
      socket.handshake.auth={};next();
    }catch{
      socket.handshake.auth={};
      if(issued)try{await auth.logout(await auth.authenticate(issued.accessToken));}catch{}
      next(new Error('Authentication failed'));
    }
  });
  io.on('connection',socket=>{
    const session=sessions.get(socket.id);
    socket.join(session.context.kind==='device'?`device:${session.context.deviceId}`:`user:${session.context.userId}`);
    socket.on('join',(_room,ack)=>{if(typeof ack==='function')ack({success:false,message:'Client room selection is forbidden'});});
    socket.on('disconnect',()=>{
      sessions.delete(socket.id);
      if(session.owned){
        const task=auth.logout(session.context).catch(()=>log.warn('Device socket session cleanup failed'));
        cleanup.add(task);void task.finally(()=>cleanup.delete(task));
      }
    });
  });
  async function current(socket){
    try{
      const session=sessions.get(socket.id);if(!session)return null;
      const context=await auth.authenticate(session.token);
      if(context.mustChangePassword)throw new Error('Password change required');
      if(context.role==='Agent')await repository.run(context,'agent-authorize');
      session.context=context;return context;
    }catch{socket.disconnect(true);return null;}
  }
  async function revalidate(){
    if(validating||stopped)return;validating=true;validationDone=new Promise(resolve=>{finishValidation=resolve;});
    try{for(const socket of io.sockets.sockets.values())await current(socket);}finally{validating=false;finishValidation();}
  }
  async function poll(){
    if(busy||stopped)return;busy=true;pollDone=new Promise(resolve=>{finishPoll=resolve;});
    try{
      const batch=await repository.events(cursor,config.offlineSeconds);
      for(const event of batch.events){
        for(const socket of io.sockets.sockets.values()){
          const context=await current(socket);if(!context)continue;
          try{
            if(!await repository.visible(context,event))continue;
            const data=event.event_name==='dashboard:stats'?(await repository.stats(context,config.offlineSeconds)).data:event.payload;
            socket.emit(event.event_name,data);
          }catch(error){
            if([401,403].includes(error.status)){socket.disconnect(true);continue;}
            throw error;
          }
        }
      }
      cursor=batch.cursor;
    }catch{log.error('Real-time synchronization failed');}finally{busy=false;finishPoll();}
  }
  function start(){
    if(validationTimer||stopped)return;
    validationTimer=setInterval(()=>void revalidate(),config.revalidateMs);validationTimer.unref();
    if(config.enabled){void poll();timer=setInterval(()=>void poll(),config.pollMs);timer.unref();}
  }
  async function stop(){
    stopped=true;clearInterval(timer);clearInterval(validationTimer);
    await Promise.all([pollDone,validationDone]);await new Promise(resolve=>io.close(resolve));await Promise.all([...cleanup]);
  }
  return {io,start,stop,poll,revalidate};
}
