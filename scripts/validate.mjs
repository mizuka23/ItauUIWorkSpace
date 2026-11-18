import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const required=['public/index.html','public/cloud.js','public/firebase-config.js','public/portal-merge.mjs','public/assets/capa-itau.png','firebase.json','.firebaserc','firestore.rules'];
for(const name of required)assert(fs.existsSync(path.join(root,name)),`Arquivo ausente: ${name}`);
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const seed=html.match(/<script id="ps-data" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
assert(seed,'Bloco ps-data ausente');assert.deepEqual(JSON.parse(seed[1]),{},'Não publique dados corporativos incorporados ao HTML');
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
 const attrs=match[1],type=attrs.match(/\btype=["']([^"']+)["']/)?.[1];
 if(/\bsrc=/.test(attrs)||type&&type!=='text/javascript'&&type!=='application/javascript')continue;
 new vm.Script(match[2],{filename:'public/index.html'});
}
for(const file of ['public/cloud.js','public/firebase-config.js','public/portal-merge.mjs']){
 const result=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||`Erro de sintaxe em ${file}`);
}
const config=JSON.parse(fs.readFileSync(path.join(root,'firebase.json'),'utf8'));
assert.equal(config.hosting.public,'public');
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.firebaserc'),'utf8')).projects.default,'itau-ui-workplace');
for(const src of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)){
 if(/^https?:\/\//.test(src[1]))continue;
 const file=path.resolve(root,'public',src[1]);assert(file.startsWith(path.join(root,'public')+path.sep));assert(fs.existsSync(file),`Script local ausente: ${src[1]}`);
}
for(const file of ['public/cloud.js','public/firebase-config.js','public/index.html'])assert(!/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(fs.readFileSync(path.join(root,file),'utf8')),`Chave privada encontrada em ${file}`);
console.log('Validação concluída: arquivos presentes, sintaxe válida e base privada fora do HTML público.');
