import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMetaAccount } from '../services/metaAccountService.js';
const permissions = {data:['pages_show_list','pages_read_engagement','instagram_basic'].map(permission=>({permission,status:'granted'}))};
const linked = {id:'page-a',access_token:'page-token',instagram_business_account:{id:'ig-a'}};
const options = {token:'user-token',appId:'app',appSecret:'secret'};

test('uses a linked Page returned by the normal Page list', async()=>{
  const result=await resolveMetaAccount({...options,getJson:async url=>url.pathname.endsWith('/permissions')?permissions:{data:[linked]}});
  assert.equal(result.page,linked);
});
test('finds a linked Page on a later result page', async()=>{
  const result=await resolveMetaAccount({...options,getJson:async url=>{
    if(url.pathname.endsWith('/permissions'))return permissions;
    if(url.searchParams.get('after')==='cursor')return {data:[linked]};
    return {data:[{id:'unlinked'}],paging:{next:'unused',cursors:{after:'cursor'}}};
  }});
  assert.equal(result.page,linked);
});
test('resolves only Page IDs from the grant when the Page list is empty', async()=>{
  const calls=[];
  const result=await resolveMetaAccount({...options,getJson:async (url,auth)=>{
    calls.push(url.pathname);
    if(url.pathname.endsWith('/permissions'))return permissions;
    if(url.pathname.endsWith('/accounts'))return {data:[]};
    if(url.pathname.endsWith('/debug_token')) {
      assert.equal(auth.headers.Authorization,'Bearer app|secret');
      return {data:{is_valid:true,app_id:'app',granular_scopes:[{scope:'instagram_basic',target_ids:['ig-a']},{scope:'pages_show_list',target_ids:['page-a']}]}};
    }
    assert.equal(auth.headers.Authorization,'Bearer user-token');
    return linked;
  }});
  assert.equal(result.page.instagram_business_account.id,'ig-a');
  assert.deepEqual(calls,['/v23.0/me/permissions','/v23.0/me/accounts','/v23.0/debug_token','/v23.0/page-a']);
});
test('does not report success for a declined permission',async()=>{
  await assert.rejects(resolveMetaAccount({...options,getJson:async()=>({data:[]})}),/permissions missing/);
});
test('does not report success when no Page is authorised',async()=>{
  await assert.rejects(resolveMetaAccount({...options,getJson:async url=>url.pathname.endsWith('/permissions')?permissions:url.pathname.endsWith('/accounts')?{data:[]}:{data:{is_valid:true,app_id:'app'}}}),/no authorised Pages/);
});
test('rejects a token issued for another app before inspecting assets',async()=>{
  await assert.rejects(resolveMetaAccount({...options,getJson:async url=>url.pathname.endsWith('/permissions')?permissions:url.pathname.endsWith('/accounts')?{data:[]}:{data:{is_valid:true,app_id:'another'}}}),/another app/);
});
