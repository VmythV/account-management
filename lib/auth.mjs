import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { HttpError } from './validation.mjs';

const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function readAuth(path) {
  try {
    const auth=JSON.parse(readFileSync(path,'utf8'));
    if (auth.algorithm!=='scrypt-v1' || !/^[a-f0-9]{32}$/.test(auth.salt) || !/^[a-f0-9]{128}$/.test(auth.hash)) throw new Error('访问密码文件损坏，请恢复备份。');
    return auth;
  } catch (error) { if(error.code==='ENOENT')return null; throw error; }
}
export async function createAuth(path, password) {
  if(typeof password!=='string' || password.trim().length<12 || password.length>256)throw new HttpError(400,'访问密码需为 12–256 个字符。');
  const salt=randomBytes(16).toString('hex');
  const hash=(await derive(password,Buffer.from(salt,'hex'),64,options)).toString('hex');
  const auth={algorithm:'scrypt-v1',salt,hash};
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  try {writeFileSync(path,JSON.stringify(auth)+'\n',{flag:'wx',mode:0o600});}
  catch(error){if(error.code==='EEXIST')throw new HttpError(409,'密码已设置，请直接登录。');throw error;}
  return auth;
}
export async function verifyPassword(auth,password) {
  if(typeof password!=='string'||password.length>256)return false;
  return timingSafeEqual(Buffer.from(auth.hash,'hex'),await derive(password,Buffer.from(auth.salt,'hex'),64,options));
}
