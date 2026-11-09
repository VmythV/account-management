import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const hash=value=>createHash('sha256').update(value).digest();
const b64=value=>Buffer.from(value).toString('base64url');
export function authenticator() {
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),id=randomBytes(32);
  const cose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
  function data(options,origin,registration,overrides) {
    const client=Buffer.from(JSON.stringify({type:registration?'webauthn.create':'webauthn.get',challenge:options.challenge,origin,crossOrigin:false,...overrides.client}));
    const counter=Buffer.alloc(4);counter.writeUInt32BE(overrides.counter||0);
    const auth=Buffer.concat([hash(overrides.rpID||options.rp?.id||options.rpId),Buffer.from([overrides.flags??(registration?0x45:0x05)]),counter]);
    return {client,auth};
  }
  return {
    register(options,origin,overrides={}) {
      const {client,auth}=data(options,origin,true,overrides),length=Buffer.alloc(2);length.writeUInt16BE(id.length);
      const attestation=isoCBOR.encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',Buffer.concat([auth,Buffer.alloc(16),length,id,cose])]]));
      return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},authenticatorAttachment:'platform',response:{clientDataJSON:b64(client),attestationObject:b64(attestation),transports:['internal']}};
    },
    authenticate(options,origin,overrides={}) {
      const {client,auth}=data(options,origin,false,overrides),signature=sign('sha256',Buffer.concat([auth,hash(client)]),overrides.privateKey||privateKey);
      return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},authenticatorAttachment:'platform',response:{clientDataJSON:b64(client),authenticatorData:b64(auth),signature:b64(signature),userHandle:overrides.userHandle??null}};
    },
  };
}
