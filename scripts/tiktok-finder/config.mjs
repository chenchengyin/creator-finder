import assert from 'node:assert/strict';
const keys=['keywords','country','days','minAverageViewsExclusive','requireBioEmail','targetCount','maxKeywords','stopAtTarget','forceProfileFirstN'];
export function normalizeConfig(input,now=new Date()){
 assert(input&&typeof input==='object'&&!Array.isArray(input),'configuration must be an object');
 assert(Object.keys(input).every(k=>keys.includes(k)),'unknown configuration key');
 assert(Array.isArray(input.keywords)&&input.keywords.length,'keywords required');
 const keywords=[],seen=new Set();
 for(const raw of input.keywords){assert(typeof raw==='string'&&raw.trim(),'invalid keyword');const word=raw.trim();if(!seen.has(word.toLowerCase())){seen.add(word.toLowerCase());keywords.push(word);}}
 assert(Number.isSafeInteger(input.days)&&input.days>0,'invalid days');
 assert(Number.isSafeInteger(input.minAverageViewsExclusive)&&input.minAverageViewsExclusive>=0,'invalid view threshold');
 let country=input.country;
 if(country!==null){assert(typeof country==='string'&&/^[A-Za-z]{2}$/.test(country),'country must be an explicit region code or null');country=country.toUpperCase();const name=new Intl.DisplayNames(['en'],{type:'region',fallback:'none'}).of(country);assert(name&&!['ZZ','XX','EU','UN'].includes(country),'invalid country');}
 const requireBioEmail=input.requireBioEmail===undefined?true:input.requireBioEmail;assert(typeof requireBioEmail==='boolean','invalid requireBioEmail');
 assert(input.targetCount===undefined||(Number.isSafeInteger(input.targetCount)&&input.targetCount>0),'invalid targetCount');
 assert(input.maxKeywords===undefined||(Number.isSafeInteger(input.maxKeywords)&&input.maxKeywords>0),'invalid maxKeywords');
 assert(input.stopAtTarget===undefined||typeof input.stopAtTarget==='boolean','invalid stopAtTarget');
 assert(!input.stopAtTarget||input.targetCount!==undefined,'stopAtTarget requires targetCount');
 assert(input.forceProfileFirstN===undefined||(Number.isSafeInteger(input.forceProfileFirstN)&&input.forceProfileFirstN>=0),'invalid forceProfileFirstN');
 const date=new Date(now);assert(Number.isFinite(date.getTime()),'invalid creation time');
 const shanghai=new Date(date.getTime()+8*3600000),end=Date.UTC(shanghai.getUTCFullYear(),shanghai.getUTCMonth(),shanghai.getUTCDate())-8*3600000;
 return {schemaVersion:1,keywords,country,days:input.days,minAverageViewsExclusive:input.minAverageViewsExclusive,requireBioEmail,...(input.targetCount===undefined?{}:{targetCount:input.targetCount}),...(input.maxKeywords===undefined?{}:{maxKeywords:input.maxKeywords}),...(input.stopAtTarget===undefined?{}:{stopAtTarget:input.stopAtTarget}),...(input.forceProfileFirstN===undefined?{}:{forceProfileFirstN:input.forceProfileFirstN}),timezone:'Asia/Shanghai',windowStart:new Date(end-input.days*86400000).toISOString(),windowEndExclusive:new Date(end).toISOString(),createdAt:date.toISOString()};
}
export function assertResumeCompatible(saved,input){
 const requested=normalizeConfig(input,saved.createdAt);
 assert.deepEqual(requested,saved,'resume configuration mismatch');
 return saved;
}
export const inputConfig=frozen=>Object.fromEntries(keys.filter(k=>frozen[k]!==undefined).map(k=>[k,frozen[k]]));
export const verificationContextFor=(config,runId)=>({runId,criteria:JSON.stringify({config:inputConfig(config),windowStart:config.windowStart,windowEndExclusive:config.windowEndExclusive})});
