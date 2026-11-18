const absent=Symbol('absent');
export const clone=value=>JSON.parse(JSON.stringify(value));
const object=value=>value!==absent&&value!==null&&typeof value==='object'&&!Array.isArray(value);
export const equal=(a,b)=>{
  if(a===b)return true;
  if(a===absent||b===absent||a===null||b===null||typeof a!==typeof b)return false;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>equal(v,b[i]));
  if(object(a)&&object(b)){const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));}
  return false;
};
const pointer=parts=>'/'+parts.map(p=>String(p).replace(/~/g,'~0').replace(/\//g,'~1')).join('/');
function arrayKey(arrays){
  const items=arrays.flat();
  if(!items.length||!items.every(object))return null;
  for(const fields of [['uid'],['id'],['grupo','linha']]){
    const key=item=>fields.every(f=>Object.hasOwn(item,f)&&item[f]!==null&&item[f]!=='')?JSON.stringify(fields.map(f=>[typeof item[f],item[f]])):null;
    if(items.every(item=>key(item)!==null)&&arrays.every(a=>new Set(a.map(key)).size===a.length))return key;
  }
  return null;
}
// Three-way merge. An unknown record identity or a delete/edit collision is
// deliberately a conflict rather than an index-based guess.
export function mergeState(base,local,remote,choices={}){
  const conflicts=[];
  function conflict(b,l,r,parts){
    const path=pointer(parts),choice=choices[path];
    if(choice==='remote')return r;
    if(choice==='local')return l;
    conflicts.push({path,local:l===absent?undefined:l,remote:r===absent?undefined:r,localDeleted:l===absent,remoteDeleted:r===absent});
    return l;
  }
  function merge(b,l,r,parts){
    if(equal(l,r))return l;
    if(equal(l,b))return r;
    if(equal(r,b))return l;
    // Save timestamps are metadata, never a business-field conflict.
    if(parts.length===1&&parts[0]==='savedAt')return [l,r].filter(v=>typeof v==='string').sort().at(-1)||null;
    if(object(l)&&object(r)&&(object(b)||b===absent)){
      const out={};for(const k of new Set([...Object.keys(b===absent?{}:b),...Object.keys(l),...Object.keys(r)])){
        const value=merge(b!==absent&&Object.hasOwn(b,k)?b[k]:absent,Object.hasOwn(l,k)?l[k]:absent,Object.hasOwn(r,k)?r[k]:absent,[...parts,k]);
        if(value!==absent)Object.defineProperty(out,k,{value,enumerable:true,writable:true,configurable:true});
      }return out;
    }
    if(Array.isArray(l)&&Array.isArray(r)&&(Array.isArray(b)||b===absent)){
      const prior=b===absent?[]:b,key=arrayKey([prior,l,r]);
      if(key){
        const bm=new Map(prior.map(v=>[key(v),v])),lm=new Map(l.map(v=>[key(v),v])),rm=new Map(r.map(v=>[key(v),v]));
        const common=prior.map(key).filter(k=>lm.has(k)&&rm.has(k));
        const lo=l.map(key).filter(k=>common.includes(k)),ro=r.map(key).filter(k=>common.includes(k));
        let order=r.map(key);
        if(!equal(lo,common)){
          if(equal(ro,common)||equal(lo,ro))order=l.map(key);
          else return conflict(b,l,r,parts);
        }
        const out=[];
        for(const k of new Set([...order,...l.map(key),...r.map(key)])){
          const item=lm.get(k)||rm.get(k)||bm.get(k),label=item.uid??item.id??`${item.grupo}:${item.linha}`;
          const rowPath=[...parts,'@'+label];
          const value=!bm.has(k)&&lm.has(k)&&rm.has(k)&&!equal(lm.get(k),rm.get(k))
            ?conflict(absent,lm.get(k),rm.get(k),rowPath)
            :merge(bm.has(k)?bm.get(k):absent,lm.has(k)?lm.get(k):absent,rm.has(k)?rm.get(k):absent,rowPath);
          if(value!==absent)out.push(value);
        }return out;
      }
    }
    return conflict(b,l,r,parts);
  }
  return {data:merge(base,local,remote,[]),conflicts};
}
