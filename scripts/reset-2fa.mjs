import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if(process.argv.length!==3||process.argv[2]!=='--confirm-reset'){
  console.error('先停止服务并备份数据库与加密密钥，然后运行：npm run reset-2fa -- --confirm-reset');
  process.exitCode=1;
}else{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const path=resolve(root,process.env.DATABASE_PATH||'data/accounts.sqlite');
  if(!existsSync(path))throw new Error('数据库不存在，未执行重置。');
  const db=new DatabaseSync(path,{timeout:5000});
  try{
    if(db.prepare('PRAGMA user_version').get().user_version!==4)throw new Error('数据库版本不匹配，未执行重置。');
    db.exec('BEGIN IMMEDIATE; DELETE FROM passkey_credentials; UPDATE vault_settings SET totpSecret=NULL,lastStep=-1,failures=0,lockedUntil=0,generation=generation+1 WHERE id=1; COMMIT;');
    console.log('验证器和通行密钥绑定已重置。已保存的密码保持加密；重启服务后，使用管理工具访问密码重新绑定验证器才能查看。');
  }finally{db.close();}
}
