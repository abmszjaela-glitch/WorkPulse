import { randomUUID } from 'node:crypto';
import { createTokenService, opaqueToken, tokenHash } from './tokens.js';

export function createDeviceService({ repository, config, policy }) {
  const tokens = createTokenService(config);
  return {
    list: (actor,options) => repository.devices(actor,'list',null,options),
    async get(actor,id) { return (await repository.devices(actor,'get',id)).items[0]; },
    write: (actor,action,id,data) => repository.devices(actor,action,id,data),
    async register(actor, { deviceCredential, ...data }) {
      const credential = opaqueToken(), refreshToken = opaqueToken();
      const result = await repository.devices(actor,'register',null,{...data,currentCredentialHash:tokenHash(deviceCredential),credentialHash:tokenHash(credential),
        sessionId:randomUUID(),refreshHash:tokenHash(refreshToken),expiresAt:new Date(Date.now()+config.refreshSeconds*1000).toISOString()});
      return { device: result.device, deviceCredential: credential, accessToken: tokens.sign(result.user,result.session),
        refreshToken, tokenType:'Bearer', expiresIn:config.accessSeconds };
    },
    heartbeat: (actor) => repository.devices(actor,'heartbeat'),
    async agentConfig(actor) { return { ...await repository.devices(actor,'agent-config'), ...policy }; },
  };
}
