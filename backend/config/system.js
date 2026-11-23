import {readFileSync} from 'node:fs';

const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
const semver=value=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value);
export function loadSystemConfig(env=process.env){
  const number=(name,fallback,min,max)=>{const n=Number(env[name]||fallback);if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(`Invalid ${name}`);return n;};
  const origins=(env.CORS_ORIGIN||'').split(',').map(x=>x.trim()).filter(Boolean);
  for(const origin of origins){const url=new URL(origin);if(!['http:','https:'].includes(url.protocol)||url.origin!==origin)throw new Error('Invalid CORS_ORIGIN');}
  const minimumAgentVersion=env.AGENT_MIN_VERSION||null;
  if(minimumAgentVersion&&!semver(minimumAgentVersion))throw new Error('Invalid AGENT_MIN_VERSION');
  let latestAgent=null;
  if(env.AGENT_INSTALLER_URL){
    const url=new URL(env.AGENT_INSTALLER_URL),size=Number(env.AGENT_INSTALLER_BYTES);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!semver(env.AGENT_LATEST_VERSION)||!/^[a-f\d]{64}$/i.test(env.AGENT_INSTALLER_SHA256||'')||!Number.isSafeInteger(size)||size<1)throw new Error('Invalid agent release configuration');
    latestAgent={version:env.AGENT_LATEST_VERSION,url:url.href,sha256:env.AGENT_INSTALLER_SHA256.toLowerCase(),bytes:size};
  }
  return {version,minimumAgentVersion,latestAgent,origins,authAttempts:number('SOCKET_AUTH_ATTEMPTS_PER_MINUTE',60,1,6000),enabled:env.REALTIME_WORKER_ENABLED==='true',pollMs:number('REALTIME_POLL_MS',2000,250,60000),revalidateMs:number('SOCKET_REVALIDATE_MS',10000,250,60000),offlineSeconds:number('DEVICE_OFFLINE_TIMEOUT_SECONDS',300,30,86400)};
}
