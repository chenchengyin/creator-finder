import test from 'node:test';
import assert from 'node:assert/strict';
import {collectCreator} from './creator.mjs';
const window={windowStart:'2026-10-12T00:00:00+08:00',windowEndExclusive:'2026-10-22T00:00:00+08:00'};
function setup(){const calls=[];return {calls,readers:{threads:async args=>{calls.push(['threads',args.navigate]);return {status:'observed',hasThreads:true};},country:async args=>{calls.push(['country',args.navigate]);return {status:'observed',countryCode:'US'};},averageViews:async()=>{calls.push(['averageViews']);return {capture:{},metrics:{averageViews:60000,coverageComplete:true,passesThreshold:true}};}}};}
test('no conditions means zero collection, navigation or analysis',async()=>{const s=setup();const r=await collectCreator({username:'example',readers:s.readers});assert.equal(r.status,'not_requested');assert.deepEqual(s.calls,[]);assert.deepEqual(r.data,{});});
test('country-only request does not inspect Threads or videos',async()=>{const s=setup();const r=await collectCreator({username:'example',conditions:{country:'US'},readers:s.readers});assert.deepEqual(s.calls,[['country',true]]);assert.equal(r.checks.country,true);});
test('Threads-only request does not inspect country or videos',async()=>{const s=setup();await collectCreator({username:'example',conditions:{hasThreads:true},readers:s.readers});assert.deepEqual(s.calls,[['threads',true]]);});
test('combined profile conditions reuse current profile and checkpoint results',async()=>{const s=setup();const states=[];const r=await collectCreator({username:'example',conditions:{country:'US',hasThreads:true},readers:s.readers,onCheckpoint:async state=>states.push(state)});assert.deepEqual(s.calls,[['threads',true],['country',false]]);assert.equal(r.matches,true);assert.equal(states[0].status,'in_progress');assert.equal(states.at(-1).status,'completed');});
test('mean-only request calls only the metrics collector',async()=>{const s=setup();const r=await collectCreator({username:'example',authorId:'123',conditions:{minAverageViewsExclusive:50000},window,readers:s.readers});assert.deepEqual(s.calls,[['averageViews']]);assert.equal(r.checks.averageViews,true);});
test('zero threshold is an explicit metrics condition',async()=>{const s=setup();await collectCreator({username:'example',authorId:'123',conditions:{minAverageViewsExclusive:0},window,readers:s.readers});assert.deepEqual(s.calls,[['averageViews']]);});
test('unknown Threads is not treated as an absent account or a pass',async()=>{const s=setup();s.readers.threads=async()=>({status:'not_observed',hasThreads:null});const r=await collectCreator({username:'example',conditions:{hasThreads:true},readers:s.readers});assert.equal(r.matches,null);assert.equal(r.checks.threads,null);});
test('protection stops later requested modules',async()=>{const s=setup();s.readers.threads=async()=>({status:'paused',reason:'instagram_login_or_challenge'});const r=await collectCreator({username:'example',conditions:{hasThreads:true,country:'US'},readers:s.readers});assert.equal(r.status,'paused');assert.deepEqual(s.calls,[]);});
test('invalid/unsupported conditions and missing fixed window fail before collection',async()=>{const s=setup();for(const conditions of[{hasThreads:'yes'},{country:'America'},{foo:true},{minAverageViewsExclusive:50000}])await assert.rejects(collectCreator({username:'example',conditions,readers:s.readers}));assert.deepEqual(s.calls,[]);});
test('Bio email condition calls only the reusable profile reader',async()=>{
 const s=setup();s.readers.profile=async args=>{s.calls.push(['profile',args.navigate]);return {status:'observed',biography:'hi work@example.com',emails:['work@example.com'],links:[],linksComplete:true};};
 const r=await collectCreator({username:'example',conditions:{requireBioEmail:true},readers:s.readers});
 assert.deepEqual(s.calls,[['profile',true]]);assert.equal(r.checks.bioEmail,true);assert.equal(r.matches,true);
});
test('false Bio email condition stays disabled and partial profile is unknown',async()=>{
 const s=setup();s.readers.profile=async()=>({status:'partial',biography:null,emails:null});
 assert.equal((await collectCreator({username:'example',conditions:{requireBioEmail:false},readers:s.readers})).status,'not_requested');
 const r=await collectCreator({username:'example',conditions:{requireBioEmail:true},readers:s.readers});assert.equal(r.matches,null);
});
test('profile without a Bio email fails and reuses navigation for subsequent conditions',async()=>{
 const s=setup();s.readers.profile=async()=>({status:'observed',biography:'No email',emails:[],linksComplete:true});
 const r=await collectCreator({username:'example',conditions:{requireBioEmail:true,hasThreads:true},readers:s.readers});
 assert.equal(r.checks.bioEmail,false);assert.equal(r.matches,false);assert.deepEqual(s.calls,[['threads',false]]);
});
