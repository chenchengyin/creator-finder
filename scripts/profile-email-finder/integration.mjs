import fs from 'node:fs/promises';
import {join} from 'node:path';
import {classifyUrl,extractCandidates,mailRecipientConflict,runFinder} from './finder.mjs';
import {createEgoBrowser} from './browser.mjs';

const siteHost=url=>{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return null;}};
function ownershipReviewReason(evidence,root,report){
 const path=evidence.path?.length?evidence.path:[report.rootUrl,evidence.sourceUrl];
 if(path.some(url=>{const c=classifyUrl(url);return c.kind==='profile'&&c.key!==root.key;})||
    classifyUrl(evidence.sourceUrl).kind==='profile'&&classifyUrl(evidence.sourceUrl).key!==root.key)return 'other_profile_ownership_unverified';
 const entry=path.map(url=>classifyUrl(url)).find(c=>c.kind==='webpage'),source=classifyUrl(evidence.sourceUrl);
 if(!entry||source.kind!=='webpage')return null;
 const siteWide=evidence.siteWide===true||evidence.source==='footer'||/(^| > )footer(?:[#.:\s]|$)/.test(evidence.location||'');
 if(entry.key===source.key&&!siteWide)return null;
 const sourceHost=siteHost(source.url);
 const linkedBack=(report.edges||[]).some(edge=>!edge.ignoredReason&&siteHost(edge.from)===sourceHost&&classifyUrl(edge.to).key===root.key);
 if(linkedBack)return null;
 const pathName=new URL(entry.url).pathname;
 if(siteHost(entry.url)===sourceHost&&(/^\/*$/.test(pathName)||/\/(?:contact(?:-(?:us|me|form))?|contacts|e-?mail|bookings?|inquir(?:y|ies)|kontakt|contato)(?:\/|\.html?$|$)/i.test(pathName)))return null;
 return 'linked_site_ownership_unverified';
}
export function summarizeEmail(report){
 const root=classifyUrl(report.rootUrl),acceptedEmails=[],reviewEmails=[];
 for(const email of report.emails||[]){
  const evidence=[],review=[];
  for(const e of email.evidence){
   const reason=e.status!=='confirmed_public'?(e.reason||'email_evidence_needs_review'):
    /^(mailto|emailto):/i.test(e.href||'')&&mailRecipientConflict(email.email,e.context,e.linkText)?'mailto_visible_recipient_conflict':
    classifyUrl(e.sourceUrl).kind==='webpage'&&/^support@/i.test(email.email)?'support_mailbox_requires_review':ownershipReviewReason(e,root,report);
   if(reason)review.push({...e,reviewReason:reason});else evidence.push(e);
  }
  if(evidence.length){
   const onRoot=source=>evidence.some(e=>classifyUrl(e.sourceUrl).key===root.key&&e.source===source);
   acceptedEmails.push({...email,evidence,sourceType:onRoot('profile_bio')?'bio':onRoot('profile_contact_email')?'profile_contact':'linked_site'});
  }
  if(review.length)reviewEmails.push({...email,evidence:review,reviewReasons:[...new Set(review.map(e=>e.reviewReason))]});
 }
 const gaps=report.completion!=='completed'||(report.pages||[]).some(p=>!['complete','alias'].includes(p.status))||(report.issues||[]).length>0;
 return {...report,acceptedEmails,reviewEmails,matches:acceptedEmails.length?true:gaps||(report.emails||[]).length?null:false};
}

// The caller owns the Page and space. A committed child run can be recovered independently.
export async function findProfileEmail({page,profile,runDir,spaceId,browser,limits={},onProgress}){
 const url=profile.profileUrl||`https://www.instagram.com/${profile.username}/`;
 let saved;
 try{saved=JSON.parse(await fs.readFile(join(runDir,'execution-state.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(saved&&classifyUrl(saved.config?.url).key!==classifyUrl(url).key)throw Error('resume URL mismatch');
 const borrowed=browser||createEgoBrowser({page,config:{spaceId}});
 const capture={url,requestedUrl:url,kind:'profile',platform:'instagram',ready:true,complete:true,
  capturedAt:profile.capturedAt||new Date().toISOString(),phase:'caller_profile',issues:[],
  blocks:[{text:profile.biography,source:'profile_bio',location:'caller_verified_biography',visible:true}],
  links:(profile.links||[]).map(link=>({...link,source:'profile_link',visible:true}))};
 const bioFound=typeof profile.biography==='string'&&extractCandidates(capture).emails.some(e=>e.status==='confirmed_public');
 const seedReady=typeof profile.biography==='string'&&(bioFound||profile.linksComplete===true);
 const adapter={session:{...borrowed.session,owned:false},async readPage(args){
  if(seedReady&&classifyUrl(args.url).key===classifyUrl(url).key){await args.onCapture(capture);return {complete:true,checkpoint:{phase:'caller_profile'}};}
  return borrowed.readPage(args);
 }};
 const result=await runFinder({config:saved?saved.config:{url,...limits},runDir,resume:!!saved,browser:adapter,onProgress});
 return summarizeEmail(result);
}
