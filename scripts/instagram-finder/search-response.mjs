import {parseSearchConnection} from './workflow.mjs';

const root='xdt_fbsearch__top_serp_graphql';
// Retain diagnostics, never request credentials or unfiltered response bodies.
function safeText(value){
 return String(value??'').replace(/https?:\/\/[^\s"<>]+/gi,'[url]')
  .replace(/(["'](?:access[_-]?token|token|sessionid|csrftoken|fb_dtsg|authorization|cookie|set-cookie)["']\s*:\s*)(?:"[^"\r\n]*"|'[^'\r\n]*')/gi,'$1"[redacted]"')
  .replace(/((?:authorization|cookie|set-cookie)\s*:\s*)[^\r\n]+/gi,'$1[redacted]')
  .replace(/((?:access[_-]?token|token|sessionid|csrftoken|fb_dtsg|authorization|cookie)\s*[=:]\s*)[^\s,;]+/gi,'$1[redacted]').slice(0,500);
}
export function analyzeSearchResponse({keyword,stage,requestId,request,response,data}){
 const params=new URLSearchParams(request?.request?.postData||'');let variables;
 try{variables=JSON.parse(params.get('variables'));}catch{}
 const operation=params.get('fb_api_req_friendly_name')||params.get('operationName')||Object.entries(request?.request?.headers||{}).find(([k])=>k.toLowerCase()==='x-fb-friendly-name')?.[1]||null;
 const connection=data?.data?.[root];
 const target=variables?.query===keyword&&(/KeywordSearch.*Query/.test(operation||'')||!!connection);
 const errors=[...(Array.isArray(data?.errors)?data.errors:[]),...(data?.error&&typeof data.error==='object'?[data.error]:[])];
 const essentialErrors=errors.filter(e=>!Array.isArray(e.path)||!e.path.length||e.path[0]===root&&e.path.at(-1)!=='profile_pic_url');
 const messages=[data?.message,data?.feedback_message,...errors.map(e=>e.message)].filter(v=>typeof v==='string').join('\n');
 const essentialMessages=[data?.message,data?.feedback_message,...essentialErrors.map(e=>e.message)].filter(v=>typeof v==='string').join('\n');
 let url=null;try{const parsed=new URL(response.url);url=parsed.origin+parsed.pathname;}catch{}
 const evidence={requestId,requestTimestamp:request?.timestamp??null,requestStage:request?.stage??'unknown',observedStage:stage,operation:safeText(operation)||null,keyword,requestKeyword:typeof variables?.query==='string'?variables.query.slice(0,200):null,requestCursor:typeof (variables?.after??variables?.cursor)==='string'?(variables.after??variables.cursor):null,url,httpStatus:response.status,scope:target?'target':request?'other':'unverified',retryAfter:safeText(Object.entries(response.headers||{}).find(([k])=>k.toLowerCase()==='retry-after')?.[1])||null,message:safeText(messages),errors:errors.slice(0,10).map(e=>({message:safeText(e.message),code:safeText(e.extensions?.code??e.code)||null,subcode:safeText(e.error_subcode??e.extensions?.error_subcode)||null,isTransient:typeof e.is_transient==='boolean'?e.is_transient:null,path:Array.isArray(e.path)?e.path.slice(0,30).map(v=>typeof v==='number'?v:safeText(v)):null})),capturedAt:new Date().toISOString(),action:'observed',reason:null};
 const result=(reason=null,page=null)=>{evidence.reason=reason;return {reason,page,evidence};};
 // Explicit session/security signals apply even if an ancillary module reports them.
 if(/login_required|login required|challenge_required|checkpoint_required/i.test(messages)){evidence.action='pause';return result('instagram_login_or_challenge');}
 if(/feedback_required|sentry_block/i.test(messages)){evidence.action='pause';return result('instagram_access_stopped_protection');}
 if(!target){evidence.action=response.status>=400||messages||errors.length?'warning':'observed';return result();}
 evidence.action='pause';
 if(response.status===401)return result('instagram_login_or_challenge');
 if(response.status===403)return result('instagram_access_stopped_403');
 if(response.status===429||/\brate\s*limit(?:ed|s)?\b|too many requests/i.test(essentialMessages))return result('instagram_access_stopped_rate_limit');
 if(/please wait a few minutes/i.test(essentialMessages))return result('instagram_access_stopped_unknown');
 if(response.status<200||response.status>=300)return result('search_response_failed');
 if(!data)return result('search_response_body_unavailable');
 if(data.status==='fail')return result('search_response_failed');
 if(essentialErrors.length)return result('search_response_failed');
 if(!Array.isArray(connection?.edges))return result('search_response_data_missing');
 for(const edge of connection.edges){
  if(!Array.isArray(edge?.node?.items))return result('search_response_data_missing');
  for(const media of edge.node.items){
   const user=media?.user||media?.owner;
   if(typeof (media?.pk||media?.id)!=='string'||!/^\d+$/.test(media.pk||media.id)||typeof media.code!=='string'||!media.code||typeof (user?.pk||user?.id)!=='string'||!/^\d+$/.test(user.pk||user.id)||typeof user?.username!=='string'||!/^[A-Za-z0-9._]{1,30}$/.test(user.username)||!Number.isInteger(media.media_type))return result('search_result_identity_unverified');
  }
 }
 const parsed=parseSearchConnection(connection);
 if(typeof parsed.hasMore!=='boolean'||parsed.hasMore&&(typeof parsed.cursor!=='string'||!parsed.cursor))return result('search_pagination_state_unknown');
 evidence.action=errors.length?'accepted_with_warning':'accepted';
 return result(null,{...parsed,keyword,connection,requestCursor:variables.after??variables.cursor??null,operation,capturedAt:evidence.capturedAt});
}
